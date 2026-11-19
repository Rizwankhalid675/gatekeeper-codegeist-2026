/**
 * rulepack.js — a project IS a rule pack.
 *
 * Onboarding a team means authoring one of these, not changing code. Two ship
 * by default and they behave differently on identical traffic, which is the
 * claim worth demonstrating: multi-tenancy here is not a field on a record, it
 * is the thing that decides what a robot is allowed to do.
 */

import { DISPOSITION, KEY, RECEIPT_EVENT, parseRulePack } from '../shared/contracts.js';
import { canonicalJSON, sha256 } from './evidence.js';
import { appendReceipt, readChain, verifyChain } from './receipts.js';

/**
 * The conservative default. A project nobody has configured gets this, and it
 * auto-executes nothing: `unattendedAllowed: false` means every proposal is
 * held for a human until somebody deliberately opts in.
 *
 * Defaulting the other way would mean installing the app changes what happens
 * to a production incident queue without anybody choosing it.
 *
 * @param {string} projectKey
 * @returns {import('../shared/contracts.js').RulePack}
 */
export function defaultRulePack(projectKey) {
  return {
    projectKey,
    name: `${projectKey} (default — unattended action off)`,
    version: 1,
    confidenceFloor: 0.75,
    unattendedAllowed: false,
    duplicateWindowMinutes: 60,
    flapThreshold: 5,
    benignSignatures: [],
    maintenanceWindows: [],
    requireHumanPriorities: ['Highest'],
    actions: [
      {
        id: 'comment-triage-summary',
        title: 'Post the triage summary as a comment',
        effect: 'comment',
        maxDisposition: DISPOSITION.AUTO,
        reversible: true,
      },
      {
        id: 'label-incident',
        title: 'Add a triage label',
        effect: 'label',
        maxDisposition: DISPOSITION.AUTO,
        reversible: true,
        allowedValues: ['gatekeeper-noise', 'gatekeeper-incident', 'gatekeeper-needs-human'],
      },
      {
        id: 'link-duplicate',
        title: 'Link this issue to the one it duplicates',
        effect: 'link',
        maxDisposition: DISPOSITION.AUTO,
        reversible: true,
      },
      {
        id: 'transition-issue',
        title: 'Move the issue through the workflow',
        effect: 'transition',
        // Capped at hold deliberately. Closing someone else's incident is the
        // action most likely to hide a real outage, so it goes to a human even
        // when every other rule passes.
        maxDisposition: DISPOSITION.HOLD,
        reversible: true,
        allowedValues: ['Triage', 'In Progress', 'Waiting for support', 'Resolved'],
      },
      {
        id: 'assign-issue',
        title: 'Assign the issue to a responder',
        effect: 'assign',
        maxDisposition: DISPOSITION.HOLD,
        reversible: true,
      },
    ],
  };
}

/**
 * The demo packs. Two tenants, deliberately different postures, so a judge can
 * run the same incident against both and watch the verdict change without a
 * line of code changing.
 *
 * northwind-msp has opted into unattended action and has a list of signatures
 * it has already decided are benign. acme-retail has not opted in at all.
 *
 * @returns {Record<string, import('../shared/contracts.js').RulePack>}
 */
export function demoRulePacks() {
  const northwind = {
    ...defaultRulePack('NW'),
    name: 'northwind-msp — unattended triage enabled',
    version: 4,
    unattendedAllowed: true,
    confidenceFloor: 0.75,
    duplicateWindowMinutes: 60,
    flapThreshold: 4,
    benignSignatures: [
      'certificate renewal completed',
      'scheduled backup verification',
      'health probe recovered after retry',
    ],
    requireHumanPriorities: ['Highest'],
    maintenanceWindows: [
      {
        label: 'Sunday patching',
        startsAt: '2026-12-06T09:00:00.000Z',
        endsAt: '2026-12-06T13:00:00.000Z',
        components: ['db-primary'],
      },
    ],
  };

  const acme = {
    ...defaultRulePack('ACME'),
    name: 'acme-retail — review everything',
    version: 2,
    unattendedAllowed: false,
    confidenceFloor: 0.9,
    duplicateWindowMinutes: 120,
    flapThreshold: 8,
    requireHumanPriorities: ['Highest', 'High'],
  };

  return { NW: northwind, ACME: acme };
}

/**
 * Load a project's pack, falling back to the conservative default.
 *
 * A stored pack that fails validation is NOT silently replaced with the
 * default — that would quietly widen or narrow what the robot may do, and
 * nobody would know which. It throws, and the caller surfaces it.
 *
 * @param {{get: (key: string) => Promise<any>}} store
 * @param {string} projectKey
 * @returns {Promise<import('../shared/contracts.js').RulePack>}
 */
export async function loadRulePack(store, projectKey) {
  const stored = await store.get(KEY.rulePack(projectKey));
  if (!stored) return defaultRulePack(projectKey);

  const parsed = parseRulePack(stored);
  if (!parsed.ok) {
    throw new Error(
      `rule pack for ${projectKey} is invalid: ${parsed.error}. ` +
        'Refusing to fall back to the default, because that would change what this project permits without anyone choosing it.',
    );
  }
  if (parsed.value.projectKey !== projectKey) {
    throw new Error(`rule pack for ${projectKey} is stored under the wrong project (${parsed.value.projectKey})`);
  }
  return parsed.value;
}

/**
 * @param {{get: (key: string) => Promise<any>, set: (key: string, value: any) => Promise<void>}} store
 * @param {import('../shared/contracts.js').RulePack} pack
 */
export async function saveRulePack(store, pack) {
  const parsed = parseRulePack(pack);
  if (!parsed.ok) throw new Error(`refusing to save an invalid rule pack: ${parsed.error}`);
  await store.set(KEY.rulePack(pack.projectKey), parsed.value);
  return parsed.value;
}

// ---------------------------------------------------------------------------
// Who changed the rules, and did it give the robot more rope?
// ---------------------------------------------------------------------------

/**
 * The digest of a rule pack, excluding its version.
 *
 * Version-independent on purpose: it answers "are these the same rules?", which
 * is the question a change record needs. Two saves that bump the version
 * without changing a rule have the same digest, and that is how a no-op save is
 * detected and refused.
 *
 * @param {import('../shared/contracts.js').RulePack} pack
 */
export function digestRulePack(pack) {
  const { version: _ignored, ...rules } = pack;
  return sha256(canonicalJSON(rules));
}

/** @param {string[]|undefined} a @param {string[]|undefined} b */
function sameSet(a, b) {
  const x = [...(a || [])].sort();
  const y = [...(b || [])].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * Describe what changed between two rule packs, in the words an administrator
 * would use, and say of each change whether it WIDENS what a robot may do.
 *
 * Widening is the asymmetry worth recording. Tightening a rule pack is a safe
 * act that needs no scrutiny; loosening one changes the behaviour of every
 * future decision in the project, and six months later the only question anyone
 * will ask is who turned it on. A diff that treats both the same buries the
 * answer in the noise.
 *
 * @param {import('../shared/contracts.js').RulePack} before
 * @param {import('../shared/contracts.js').RulePack} after
 * @returns {{text: string, widens: boolean}[]}
 */
export function summariseRulePackChange(before, after) {
  /** @type {{text: string, widens: boolean}[]} */
  const out = [];
  const add = (text, widens) => out.push({ text, widens });

  if (before.name !== after.name) add(`renamed "${before.name}" to "${after.name}"`, false);

  if (before.unattendedAllowed !== after.unattendedAllowed) {
    add(
      after.unattendedAllowed
        ? 'unattended action switched ON — actions cleared for auto may now run without a human'
        : 'unattended action switched OFF — every proposal is held for a human',
      after.unattendedAllowed === true,
    );
  }

  if (before.confidenceFloor !== after.confidenceFloor) {
    add(
      `confidence floor ${before.confidenceFloor} → ${after.confidenceFloor}`,
      after.confidenceFloor < before.confidenceFloor,
    );
  }

  if (!sameSet(before.requireHumanPriorities, after.requireHumanPriorities)) {
    const removed = (before.requireHumanPriorities || []).filter((p) => !(after.requireHumanPriorities || []).includes(p));
    add(
      `priorities that always go to a human: ${fmtList(before.requireHumanPriorities)} → ${fmtList(after.requireHumanPriorities)}`,
      removed.length > 0,
    );
  }

  if (!sameSet(before.benignSignatures, after.benignSignatures)) {
    const added = (after.benignSignatures || []).filter((s) => !(before.benignSignatures || []).includes(s));
    // More benign signatures means more alerts closed without a human seeing
    // them. That is the point of the feature and it is still a widening.
    add(`known-benign signatures: ${(before.benignSignatures || []).length} → ${(after.benignSignatures || []).length}`, added.length > 0);
  }

  const beforeWindows = (before.maintenanceWindows || []).length;
  const afterWindows = (after.maintenanceWindows || []).length;
  if (beforeWindows !== afterWindows) {
    // R11 holds inside a window, so removing one removes a hold.
    add(`maintenance windows: ${beforeWindows} → ${afterWindows}`, afterWindows < beforeWindows);
  }

  const beforeActions = new Map((before.actions || []).map((a) => [a.id, a]));
  const afterActions = new Map((after.actions || []).map((a) => [a.id, a]));

  for (const [id, a] of afterActions) {
    if (!beforeActions.has(id)) {
      add(`added action "${id}" (${a.effect}, ${a.maxDisposition === DISPOSITION.AUTO ? 'cleared for auto' : 'capped at hold'})`, true);
    }
  }
  for (const id of beforeActions.keys()) {
    if (!afterActions.has(id)) add(`removed action "${id}" — R01 now refuses it`, false);
  }

  for (const [id, now] of afterActions) {
    const was = beforeActions.get(id);
    if (!was) continue;

    if (was.maxDisposition !== now.maxDisposition) {
      add(
        `"${id}" ${now.maxDisposition === DISPOSITION.AUTO ? 'cleared for unattended use' : 'capped at hold'}`,
        now.maxDisposition === DISPOSITION.AUTO,
      );
    }
    if ((was.reversible !== false) !== (now.reversible !== false)) {
      add(
        `"${id}" marked ${now.reversible === false ? 'irreversible — R10 now holds it' : 'reversible — R10 no longer holds it'}`,
        now.reversible !== false,
      );
    }
    if (!sameSet(was.allowedValues, now.allowedValues)) {
      const wasAny = (was.allowedValues || []).length === 0;
      const nowAny = (now.allowedValues || []).length === 0;
      const added = (now.allowedValues || []).filter((v) => !(was.allowedValues || []).includes(v));
      add(
        nowAny && !wasAny
          ? `"${id}" permitted values cleared — R02 now allows ANY value`
          : `"${id}" permitted values: ${fmtList(was.allowedValues)} → ${fmtList(now.allowedValues)}`,
        // An empty list means "any value", so clearing it is the widest change
        // available on an action and must not read as a tightening.
        (nowAny && !wasAny) || added.length > 0,
      );
    }
    if (was.title !== now.title) add(`"${id}" retitled to "${now.title}"`, false);
    if (was.effect !== now.effect) add(`"${id}" effect ${was.effect} → ${now.effect}`, true);
  }

  return out;
}

/** @param {string[]|undefined} list */
function fmtList(list) {
  const l = list || [];
  return l.length ? l.join(', ') : 'none';
}

/**
 * Save a rule pack, refusing a lost update, and record who changed what.
 *
 * Two properties this adds over `saveRulePack`:
 *
 *  1. **Optimistic concurrency.** The caller says which version it was editing.
 *     If storage has moved on, the save is refused rather than silently
 *     overwriting. Forge storage has no compare-and-swap, so this is a check
 *     and not a guarantee — two saves landing in the same instant can still
 *     interleave — but it closes the case that actually happens: two tabs, one
 *     opened before the other saved.
 *
 *  2. **An audit receipt**, on the project's own sha256 chain, naming the
 *     person, the version, what changed and whether it widened what a robot may
 *     do.
 *
 * A save that changes no rule is refused rather than written. A version bump
 * makes every pending verdict stale, and spending that on a no-op costs a
 * human a re-run for nothing.
 *
 * @param {import('./receipts.js').Store} store
 * @param {object} args
 * @param {import('../shared/contracts.js').RulePack} args.pack
 * @param {number} [args.basedOnVersion]  the version the editor loaded
 * @param {string} args.actor             'user:<accountId>'
 * @param {string} args.now               ISO
 */
export async function commitRulePack(store, { pack, basedOnVersion, actor, now }) {
  const current = await loadRulePack(store, pack.projectKey);

  if (typeof basedOnVersion === 'number' && basedOnVersion !== current.version) {
    const e = new Error(
      `This rule pack was edited elsewhere: you are changing v${basedOnVersion}, but ${pack.projectKey} is now at v${current.version}. ` +
        'Nothing was saved. Reload to see the current rules before changing them.',
    );
    e.conflict = true;
    e.current = current;
    throw e;
  }

  const changes = summariseRulePackChange(current, pack);
  if (changes.length === 0) return { rulePack: current, changes: [], receipt: null };

  const next = await saveRulePack(store, { ...pack, version: current.version + 1 });

  const widening = changes.filter((c) => c.widens);
  const reason =
    `v${current.version} → v${next.version}. ` +
    (widening.length > 0 ? `WIDENS (${widening.length}): ${widening.map((c) => c.text).join('; ')}. ` : '') +
    (changes.length > widening.length
      ? `Other: ${changes.filter((c) => !c.widens).map((c) => c.text).join('; ')}.`
      : '');

  const receipt = await appendReceipt(store, {
    issueKey: KEY.rulePackChain(pack.projectKey),
    actor,
    event: RECEIPT_EVENT.RULEPACK_CHANGED,
    // The pack's own digest, so the record says WHICH rules were saved and not
    // merely that a save happened.
    evidenceDigest: digestRulePack(next),
    rulePackVersion: next.version,
    action: null,
    reason: reason.trim(),
    at: now,
  });

  return { rulePack: next, changes, receipt };
}

/**
 * The project's rule pack history, newest first, with the chain verified.
 *
 * @param {import('./receipts.js').Store} store
 * @param {string} projectKey
 */
export async function readRulePackHistory(store, projectKey) {
  const chain = await readChain(store, KEY.rulePackChain(projectKey));
  return { chain: [...chain].reverse(), verification: verifyChain(chain) };
}
