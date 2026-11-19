/**
 * pipeline.js — where untrusted model output crosses into trusted code.
 *
 * Forge action inputs are flat scalars, so a Rovo agent's proposal arrives as
 * loose strings and numbers. That is not a limitation to route around: it is the
 * trust boundary made visible. Everything here parses, validates and then stops
 * trusting the input.
 *
 * The flow, deliberately split across two actions invoked by two different
 * agents:
 *
 *   gatekeeper-agent    -> triage-incident  -> proposal stored, gate run, HELD on R07
 *   gatekeeper-reviewer -> review-proposal  -> review stored, gate re-run, maybe executed
 *
 * The proposer cannot clear its own R07, because the gate holds anything with no
 * review on the record. Self-review is possible only if someone wires the same
 * agent to both actions, which is why they have separate prompts and separate
 * module keys.
 */

import { DISPOSITION, KEY, RECEIPT_EVENT, parseAgentProposal } from '../shared/contracts.js';
import { buildBundle, correlate, signatureOf } from '../gate/evidence.js';
import { decide } from '../gate/gate.js';
import { appendReceipt, readChain, renderReceipt, verifyChain } from '../gate/receipts.js';
import { loadRulePack } from '../gate/rulepack.js';
import { execute } from '../executor.js';

/**
 * Parse the `params` an agent supplied as a JSON string.
 *
 * A model that returns malformed JSON here gets an error, not an empty object.
 * Defaulting to `{}` would turn "comment with this body" into "comment with no
 * body", which the executor would then reject for a missing parameter — and the
 * operator would be told the wrong thing about why.
 *
 * @param {string|undefined} raw
 * @returns {{ok: true, value: Record<string, any>} | {ok: false, error: string}}
 */
export function parseParams(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return { ok: true, value: {} };
  try {
    const v = JSON.parse(String(raw));
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      return { ok: false, error: 'params must be a JSON object, for example {"body":"..."}' };
    }
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: `params is not valid JSON: ${e.message}` };
  }
}

/**
 * Agents supply quotes as one block of text. Split on newlines, drop blanks.
 * @param {string|undefined} raw
 */
export function parseQuotes(raw) {
  if (!raw) return [];
  return String(raw)
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Gather the facts and build the bundle. Deterministic given Jira's state.
 *
 * @param {object} deps
 * @param {string} issueKey
 */
export async function gatherEvidence(deps, issueKey) {
  const incident = await deps.jira.fetchIncident(issueKey);
  const rulePack = await loadRulePack(deps.store, incident.projectKey);

  const [comments, linkedIssues, recentRaw] = await Promise.all([
    deps.jira.fetchComments(issueKey),
    deps.jira.fetchLinkedIssues(issueKey),
    deps.jira.fetchRecentIssues(incident.projectKey, rulePack.duplicateWindowMinutes),
  ]);

  const recent = recentRaw.map((r) => ({
    issueKey: r.issueKey,
    signature: signatureOf(r),
    createdAt: r.createdAt,
  }));

  const correlation = correlate({ incident, recent, rulePack, now: deps.now() });
  const bundle = buildBundle({ incident, comments, linkedIssues, correlation });

  return { incident, rulePack, bundle };
}

/**
 * Run the gate over whatever proposal and review are on the record, and execute
 * only if the gate says so. Called by both actions, so a review arriving later
 * re-decides the same way a fresh triage would.
 *
 * @param {object} deps
 * @param {object} args
 */
async function evaluateAndMaybeExecute(deps, { bundle, rulePack, proposal, review }) {
  const now = deps.now();
  const verdict = decide({ proposal, review, bundle, rulePack, now });
  await deps.store.set(KEY.verdict(bundle.issueKey), verdict);

  if (verdict.disposition === DISPOSITION.AUTO) {
    try {
      const result = await execute({
        verdict,
        proposal,
        review,
        bundle,
        rulePack,
        effects: deps.effects,
        store: deps.store,
        now,
      });
      return { verdict, receipt: result.receipt, executed: result.executed };
    } catch (e) {
      // The executor writes a `failed` receipt before re-throwing, so the
      // attempt is already on the record. Pick it up and return the failure as
      // data: these functions are action handlers, and an agent that receives an
      // opaque rejection will simply try the same thing again.
      const chain = await readChain(deps.store, bundle.issueKey);
      return { verdict, receipt: chain[chain.length - 1], executed: false, error: e.message };
    }
  }

  const receipt = await appendReceipt(deps.store, {
    issueKey: bundle.issueKey,
    actor: 'gatekeeper:gate',
    event: verdict.disposition === DISPOSITION.REJECT ? RECEIPT_EVENT.REJECTED : RECEIPT_EVENT.HELD,
    evidenceDigest: bundle.digest,
    rulePackVersion: rulePack.version,
    action: verdict.action,
    reason: verdict.reason,
    at: now,
  });

  return { verdict, receipt, executed: false };
}

/**
 * `triage-incident`. The proposing agent's output arrives here.
 *
 * @param {object} deps
 * @param {object} input
 */
export async function runTriage(deps, input) {
  const issueKey = String(input.issueKey || '').trim();
  if (!issueKey) return { ok: false, error: 'issueKey is required.' };

  const { rulePack, bundle } = await gatherEvidence(deps, issueKey);

  // Correlation closes the alert before a single rule runs. This is where most
  // of the volume goes, and every closure states its reason in writing.
  if (bundle.correlation.suppress) {
    const now = deps.now();
    const receipt = await appendReceipt(deps.store, {
      issueKey,
      actor: 'gatekeeper:correlation',
      event: RECEIPT_EVENT.SUPPRESSED,
      evidenceDigest: bundle.digest,
      rulePackVersion: rulePack.version,
      action: null,
      reason: `Suppressed as ${bundle.correlation.reason}. Signature seen ${bundle.correlation.signatureCount} time(s) in the last ${rulePack.duplicateWindowMinutes} minutes.`,
      at: now,
    });
    return {
      ok: true,
      outcome: 'suppressed',
      reason: receipt.reason,
      relatedIssues: bundle.correlation.relatedIssueKeys,
      evidenceDigest: bundle.digest,
      receipt: receipt.digest,
      note: 'No model was asked about this incident. Correlation is deterministic and runs first.',
    };
  }

  const params = parseParams(input.params);
  if (!params.ok) return { ok: false, error: params.error };

  const parsed = parseAgentProposal({
    agent: 'remediation',
    issueKey,
    evidenceDigest: bundle.digest,
    rationale: input.rationale,
    confidence: typeof input.confidence === 'number' ? input.confidence : Number(input.confidence),
    quotes: parseQuotes(input.quotes),
    action: input.actionId ? { id: String(input.actionId), params: params.value } : null,
  });

  if (!parsed.ok) {
    // Malformed model output is refused and nothing is stored. Reporting the
    // reason back lets the agent correct itself on the next turn.
    return {
      ok: false,
      error: `Proposal refused before it reached the policy gate: ${parsed.error}`,
      evidenceDigest: bundle.digest,
    };
  }

  await deps.store.set(KEY.run(issueKey), { proposal: parsed.value, review: null, at: deps.now() });

  const { verdict, receipt, executed, error } = await evaluateAndMaybeExecute(deps, {
    bundle,
    rulePack,
    proposal: parsed.value,
    review: null,
  });

  await commentReceipt(deps, { bundle, receipt, verdict });

  return {
    ok: !error,
    error,
    outcome: verdict.disposition,
    executed,
    reason: verdict.reason,
    evidenceDigest: bundle.digest,
    rulePackVersion: rulePack.version,
    rulesFired: verdict.outcomes.filter((o) => o.fired).map((o) => `${o.rule}: ${o.detail}`),
    receipt: receipt.digest,
    // Triage always runs with no review on the record, so R07 is expected to
    // fire here. Saying so plainly stops the agent reporting a hold as a
    // failure, and tells the operator what the next step actually is.
    nextStep: verdict.outcomes.find((o) => o.rule === 'R07')?.fired
      ? 'Held pending adversarial review. The Gatekeeper Reviewer agent must call review-proposal before anything runs unattended.'
      : undefined,
  };
}

/**
 * `review-proposal`. The reviewing agent's verdict arrives here.
 *
 * Note what is NOT trusted: the reviewer's own claim about whether its quotes
 * check out. The gate re-verifies every quote against source evidence itself.
 *
 * @param {object} deps
 * @param {object} input
 */
export async function runReview(deps, input) {
  const issueKey = String(input.issueKey || '').trim();
  if (!issueKey) return { ok: false, error: 'issueKey is required.' };

  const verdictWord = String(input.verdict || '').toLowerCase().trim();
  if (verdictWord !== 'confirm' && verdictWord !== 'dissent') {
    return { ok: false, error: 'verdict must be exactly "confirm" or "dissent".' };
  }

  const run = await deps.store.get(KEY.run(issueKey));
  if (!run?.proposal) {
    return { ok: false, error: `There is no proposal on the record for ${issueKey}. Run triage-incident first.` };
  }

  const { rulePack, bundle } = await gatherEvidence(deps, issueKey);

  // The proposal was made about a particular view of the issue. If the issue has
  // moved since, R03 will reject it — but say so here too, because an agent
  // being told "rejected" without being told why will simply try again.
  const stale = run.proposal.evidenceDigest !== bundle.digest;

  /** @type {import('../shared/contracts.js').ReviewVerdict} */
  const review = {
    verdict: verdictWord,
    quotes: parseQuotes(input.quotes),
    // Set to false and left alone: the gate computes the real answer. Storing a
    // claimed `true` here would put a model-supplied value somewhere that looks
    // authoritative.
    quotesVerified: false,
    unverifiedQuotes: [],
    rationale: String(input.rationale || '').trim() || '(no rationale given)',
  };

  await deps.store.set(KEY.run(issueKey), { ...run, review, at: deps.now() });

  const { verdict, receipt, executed, error } = await evaluateAndMaybeExecute(deps, {
    bundle,
    rulePack,
    proposal: run.proposal,
    review,
  });

  await commentReceipt(deps, { bundle, receipt, verdict });

  const r08 = verdict.outcomes.find((o) => o.rule === 'R08');

  return {
    ok: !error,
    error,
    outcome: verdict.disposition,
    executed,
    reason: verdict.reason,
    citationCheck: r08?.detail,
    staleEvidence: stale || undefined,
    rulesFired: verdict.outcomes.filter((o) => o.fired).map((o) => `${o.rule}: ${o.detail}`),
    receipt: receipt.digest,
  };
}

/**
 * Leave the receipt on the issue. An operator should be able to audit a decision
 * from the issue alone, without opening the app.
 *
 * A failure here must not change the decision that was already made and
 * recorded — the receipt is in storage either way — so it is reported rather
 * than thrown.
 */
async function commentReceipt(deps, { bundle, receipt, verdict }) {
  try {
    await deps.effects.comment(bundle.issueKey, renderReceipt(receipt, verdict));
    return true;
  } catch (e) {
    deps.log?.(`could not write the receipt comment on ${bundle.issueKey}: ${e.message}`);
    return false;
  }
}

/**
 * `explain-verdict`. Reads stored state only.
 */
export async function runExplain(deps, input) {
  const issueKey = String(input.issueKey || '').trim();
  if (!issueKey) return { ok: false, error: 'issueKey is required.' };

  const verdict = await deps.store.get(KEY.verdict(issueKey));
  if (!verdict) return { ok: true, outcome: 'none', reason: `Gatekeeper has not decided anything on ${issueKey} yet.` };

  return {
    ok: true,
    outcome: verdict.disposition,
    reason: verdict.reason,
    rulePackVersion: verdict.rulePackVersion,
    decidedAt: verdict.decidedAt,
    // All twelve, passed and fired. An operator reading a hold needs to see
    // which rules cleared to know the hold was specific.
    rules: verdict.outcomes.map((o) => ({ rule: o.rule, title: o.title, fired: o.fired, detail: o.detail })),
  };
}

/**
 * `read-receipts`. Reads stored state only, and reports whether the chain
 * verifies rather than asserting that it does.
 */
export async function runReadReceipts(deps, input) {
  const issueKey = String(input.issueKey || '').trim();
  if (!issueKey) return { ok: false, error: 'issueKey is required.' };

  const chain = await readChain(deps.store, issueKey);
  const check = verifyChain(chain);

  return {
    ok: true,
    length: chain.length,
    chainVerified: check.ok,
    chainProblem: check.ok ? undefined : `${check.problem} (at receipt ${check.at})`,
    receipts: chain.map((r) => ({
      seq: r.seq,
      event: r.event,
      actor: r.actor,
      action: r.action?.id ?? null,
      reason: r.reason,
      at: r.at,
      rulePackVersion: r.rulePackVersion,
      digest: r.digest.slice(0, 12),
      prev: r.prev.slice(0, 12),
    })),
  };
}

/**
 * `describe-rulepack`. What this project permits, in plain terms.
 */
export async function runDescribeRulePack(deps, input) {
  const projectKey = String(input.projectKey || '').trim();
  if (!projectKey) return { ok: false, error: 'projectKey is required.' };

  const pack = await loadRulePack(deps.store, projectKey);

  return {
    ok: true,
    projectKey: pack.projectKey,
    name: pack.name,
    version: pack.version,
    unattendedAllowed: pack.unattendedAllowed,
    confidenceFloor: pack.confidenceFloor,
    duplicateWindowMinutes: pack.duplicateWindowMinutes,
    flapThreshold: pack.flapThreshold,
    prioritiesAlwaysHuman: pack.requireHumanPriorities,
    benignSignatureCount: pack.benignSignatures.length,
    maintenanceWindows: pack.maintenanceWindows.map((w) => `${w.label}: ${w.startsAt} to ${w.endsAt}`),
    actions: pack.actions.map((a) => ({
      id: a.id,
      title: a.title,
      effect: a.effect,
      canRunUnattended: a.maxDisposition === DISPOSITION.AUTO && pack.unattendedAllowed === true,
      reversible: a.reversible,
      allowedValues: a.allowedValues,
    })),
    note: pack.unattendedAllowed
      ? 'Unattended action is enabled for this project. Actions still pass all twelve rules first.'
      : 'Unattended action is switched OFF for this project. Every proposal is held for a human.',
  };
}
