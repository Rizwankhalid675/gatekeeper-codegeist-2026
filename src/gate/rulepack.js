/**
 * rulepack.js — a project IS a rule pack.
 *
 * Onboarding a team means authoring one of these, not changing code. Two ship
 * by default and they behave differently on identical traffic, which is the
 * claim worth demonstrating: multi-tenancy here is not a field on a record, it
 * is the thing that decides what a robot is allowed to do.
 */

import { DISPOSITION, KEY, parseRulePack } from '../shared/contracts.js';

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
