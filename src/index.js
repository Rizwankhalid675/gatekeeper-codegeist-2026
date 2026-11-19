/**
 * index.js — the Forge entry point. Wiring only.
 *
 * Every handler here does the same three things: build the dependency bundle,
 * call a function from src/agent/pipeline.js, and turn a thrown error into
 * something an agent or a panel can read. No decisions are made in this file.
 *
 * `deps` is the seam. In the Forge runtime it is real storage, real Jira and the
 * real clock; in tests it is an in-memory store, fake effects and a pinned
 * timestamp. That is why the gate and the executor have 77 tests and need no
 * Forge runtime to run them.
 */

import ForgeResolver from '@forge/resolver';

/**
 * @forge/resolver is CommonJS (`exports.default = Resolver`, with __esModule).
 * This package sets `"type": "module"`, so the Forge bundler hands us the module
 * NAMESPACE rather than the class, and `new Resolver()` dies at import time with
 * "out_namespaceObject is not a constructor" — before any handler can run, so
 * every resolver call fails and the panel spins forever.
 *
 * Unwrapping explicitly works under both interops. Found only by deploying and
 * reading forge logs; no local test sees this, because locally Node resolves the
 * same import correctly.
 */
const Resolver = ForgeResolver?.default ?? ForgeResolver;

import { KEY } from './shared/contracts.js';
import { forgeStore } from './platform/store.js';
import {
  fetchComments,
  fetchIncident,
  fetchLinkedIssues,
  fetchProjects,
  fetchRecentIssues,
  forgeEffects,
} from './platform/jira.js';
import { loadRulePack, saveRulePack, demoRulePacks } from './gate/rulepack.js';
import { readChain, verifyChain } from './gate/receipts.js';
import { overrideAndExecute } from './executor.js';
import {
  gatherEvidence,
  runDescribeRulePack,
  runExplain,
  runReadReceipts,
  runReview,
  runTriage,
} from './agent/pipeline.js';

function deps() {
  return {
    store: forgeStore,
    effects: forgeEffects,
    jira: { fetchIncident, fetchComments, fetchLinkedIssues, fetchRecentIssues },
    now: () => new Date().toISOString(),
    log: (msg) => console.log(`[gatekeeper] ${msg}`),
  };
}

/**
 * Agents read whatever comes back, so an error has to be returned as data with
 * an explanation. A rejected promise here surfaces to the agent as an opaque
 * failure, and an agent that cannot see why it failed will simply try the same
 * thing again.
 *
 * @param {() => Promise<any>} fn
 * @param {string} what
 */
async function guard(fn, what) {
  try {
    return await fn();
  } catch (e) {
    console.error(`[gatekeeper] ${what} failed`, e);
    return { ok: false, error: `${what} failed: ${e.message}` };
  }
}

// --- Rovo actions -----------------------------------------------------------

export async function triageIncident(payload) {
  return guard(() => runTriage(deps(), payload || {}), 'triage-incident');
}

export async function reviewProposal(payload) {
  return guard(() => runReview(deps(), payload || {}), 'review-proposal');
}

export async function explainVerdict(payload) {
  return guard(() => runExplain(deps(), payload || {}), 'explain-verdict');
}

export async function readReceipts(payload) {
  return guard(() => runReadReceipts(deps(), payload || {}), 'read-receipts');
}

export async function describeRulePack(payload) {
  return guard(() => runDescribeRulePack(deps(), payload || {}), 'describe-rulepack');
}

// --- UI resolvers -----------------------------------------------------------

const resolver = new Resolver();

/**
 * Everything the console panel shows for one issue, in one round trip. The
 * panel renders what it is given and computes nothing, so there is no second
 * copy of the policy logic in the front end to drift out of step.
 */
resolver.define('getConsole', async ({ context }) => {
  const issueKey = context?.extension?.issue?.key;
  if (!issueKey) return { ok: false, error: 'No issue in context.' };

  return guard(async () => {
    const d = deps();
    const { rulePack, bundle } = await gatherEvidence(d, issueKey);
    const verdict = await d.store.get(KEY.verdict(issueKey));
    const run = await d.store.get(KEY.run(issueKey));
    const chain = await readChain(d.store, issueKey);
    const chainCheck = verifyChain(chain);

    return {
      ok: true,
      issueKey,
      rulePack: {
        name: rulePack.name,
        version: rulePack.version,
        unattendedAllowed: rulePack.unattendedAllowed,
        confidenceFloor: rulePack.confidenceFloor,
      },
      evidence: {
        digest: bundle.digest,
        priority: bundle.priority,
        status: bundle.status,
        items: bundle.items.map((i) => ({ id: i.id, kind: i.kind, source: i.source, text: i.text.slice(0, 600) })),
        correlation: bundle.correlation,
      },
      handoff: {
        proposal: run?.proposal
          ? {
              rationale: run.proposal.rationale,
              confidence: run.proposal.confidence,
              quotes: run.proposal.quotes,
              action: run.proposal.action,
            }
          : null,
        review: run?.review
          ? { verdict: run.review.verdict, rationale: run.review.rationale, quotes: run.review.quotes }
          : null,
      },
      verdict: verdict || null,
      // A stored verdict reached against an older view of the issue is stale,
      // and the panel says so rather than presenting it as current.
      verdictIsStale: Boolean(verdict && verdict.evidenceDigest !== bundle.digest),
      receipts: chain.map((r) => ({
        seq: r.seq,
        event: r.event,
        actor: r.actor,
        action: r.action?.id ?? null,
        reason: r.reason,
        at: r.at,
        digest: r.digest.slice(0, 12),
        prev: r.prev.slice(0, 12),
      })),
      chainVerified: chainCheck.ok,
      chainProblem: chainCheck.ok ? null : `${chainCheck.problem} (at receipt ${chainCheck.at})`,
    };
  }, 'load the console');
});

/**
 * The operator taking an action Gatekeeper held. Runs as the user, and the
 * receipt records their accountId — the chain has to distinguish "the robot did
 * this" from "a person overrode the robot".
 */
resolver.define('approveHeldAction', async ({ context }) => {
  const issueKey = context?.extension?.issue?.key;
  const accountId = context?.accountId;
  if (!issueKey) return { ok: false, error: 'No issue in context.' };
  if (!accountId) return { ok: false, error: 'Could not identify who is approving this.' };

  return guard(async () => {
    const d = deps();
    const { rulePack, bundle } = await gatherEvidence(d, issueKey);
    const verdict = await d.store.get(KEY.verdict(issueKey));
    if (!verdict) return { ok: false, error: 'There is no verdict to approve.' };

    // Re-derived against the CURRENT evidence. Approving a verdict reached
    // against a stale view of the issue would act on a situation that has
    // already changed.
    if (verdict.evidenceDigest !== bundle.digest) {
      return {
        ok: false,
        error:
          'The issue has changed since this verdict was reached, so it is no longer valid. Re-run triage before approving.',
      };
    }

    const { receipt } = await overrideAndExecute({
      verdict,
      bundle,
      rulePack,
      effects: d.effects,
      store: d.store,
      accountId,
      now: d.now(),
    });

    return { ok: true, receipt: receipt.digest, action: verdict.action?.id ?? null };
  }, 'approve the held action');
});

/**
 * What the rule pack editor needs before it can show anything: the project from
 * context if there is one (project settings page), and the list to choose from
 * if there is not (global page).
 */
resolver.define('bootstrap', async ({ context }) => {
  return guard(async () => {
    const contextProjectKey = context?.extension?.project?.key || null;
    const projects = await fetchProjects();
    return { ok: true, contextProjectKey, projects };
  }, 'list the projects');
});

resolver.define('getRulePack', async ({ context, payload }) => {
  const projectKey = payload?.projectKey || context?.extension?.project?.key;
  if (!projectKey) return { ok: false, error: 'No project in context.' };
  return guard(async () => ({ ok: true, rulePack: await loadRulePack(forgeStore, projectKey) }), 'load the rule pack');
});

resolver.define('saveRulePack', async ({ payload }) => {
  if (!payload?.rulePack) return { ok: false, error: 'No rule pack supplied.' };
  return guard(async () => {
    const current = await loadRulePack(forgeStore, payload.rulePack.projectKey);
    // Bumping the version on every save is what makes a stored verdict from
    // before the change detectably stale, so an older verdict cannot be
    // executed under rules that have since been tightened.
    const next = { ...payload.rulePack, version: current.version + 1 };
    return { ok: true, rulePack: await saveRulePack(forgeStore, next) };
  }, 'save the rule pack');
});

/**
 * Load one of the two demo packs, for a judge who wants to see the same
 * incident decided differently without authoring a pack by hand.
 */
resolver.define('loadDemoRulePack', async ({ context, payload }) => {
  // The project comes from the payload on a global page and from context on a
  // project settings page. Context alone would make this unusable from the one
  // surface that is actually reachable in the Jira navigation.
  const projectKey = payload?.projectKey || context?.extension?.project?.key;
  const which = payload?.which === 'acme' ? 'ACME' : 'NW';
  if (!projectKey) return { ok: false, error: 'No project selected.' };

  return guard(async () => {
    const packs = demoRulePacks();
    const current = await loadRulePack(forgeStore, projectKey);
    const next = { ...packs[which], projectKey, version: current.version + 1 };
    return { ok: true, rulePack: await saveRulePack(forgeStore, next) };
  }, 'load the demo rule pack');
});

export const handler = resolver.getDefinitions();
