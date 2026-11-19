/**
 * rulepack.test.js — what a rule pack is allowed to be.
 *
 * The rule pack editor can now author actions, which moves a class of error
 * from "a developer wrote it" to "an administrator typed it at 5pm". So the
 * validator is the thing standing between a typo and an action that passes
 * every rule and then cannot be performed.
 *
 * The principle under all of these: refuse at the point somebody wrote it down,
 * not at the point a robot tries to act on it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DISPOSITION, EFFECT, RECEIPT_EVENT, parseRulePack } from '../src/shared/contracts.js';
import {
  commitRulePack,
  defaultRulePack,
  demoRulePacks,
  digestRulePack,
  loadRulePack,
  readRulePackHistory,
  saveRulePack,
  summariseRulePackChange,
} from '../src/gate/rulepack.js';
import { memStore } from './helpers.js';

/** A minimal valid pack, so each test can break exactly one thing. */
const pack = (over = {}) => ({
  ...defaultRulePack('NW'),
  ...over,
});

const action = (over = {}) => ({
  id: 'label-needs-vendor',
  title: 'Label the issue for the vendor queue',
  effect: EFFECT.LABEL,
  maxDisposition: DISPOSITION.HOLD,
  reversible: true,
  ...over,
});

test('every pack Gatekeeper ships validates', () => {
  // If this fails, the validator has been tightened past the product's own
  // configuration — which would mean nobody could save the demo packs either.
  assert.equal(parseRulePack(defaultRulePack('NW')).ok, true);
  for (const [name, p] of Object.entries(demoRulePacks())) {
    const r = parseRulePack(p);
    assert.equal(r.ok, true, `demo pack ${name} is invalid: ${r.error}`);
  }
});

test('a valid authored action is accepted', () => {
  const r = parseRulePack(pack({ actions: [action()] }));
  assert.equal(r.ok, true, r.error);
});

test('an effect with no implementation behind it is refused', () => {
  // The whole reason EFFECT exists as a constant. "delete" is plausible, reads
  // like the others, and has no case in the executor's dispatch.
  const r = parseRulePack(pack({ actions: [action({ effect: 'delete' })] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /effect must be one of/);
  assert.match(r.error, /comment/);
});

test('a missing effect is refused rather than defaulted', () => {
  const { effect: _drop, ...noEffect } = action();
  const r = parseRulePack(pack({ actions: [noEffect] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /effect must be one of/);
});

test('an action with no title is refused, because a hold has to be readable', () => {
  const r = parseRulePack(pack({ actions: [action({ title: '   ' })] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /title/);
});

test('reversible must be a boolean, so a string cannot defeat R10', () => {
  // "false" is truthy. R10 holds when reversible === false, so a string here
  // would mark an irreversible action as safe while looking correct in JSON.
  const r = parseRulePack(pack({ actions: [action({ reversible: 'false' })] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /reversible must be true or false/);
});

test('an absent reversible flag is still allowed and means reversible', () => {
  const { reversible: _drop, ...noFlag } = action();
  assert.equal(parseRulePack(pack({ actions: [noFlag] })).ok, true);
});

test('allowedValues must be strings, because R02 compares them as strings', () => {
  const r = parseRulePack(pack({ actions: [action({ allowedValues: ['Triage', 7] })] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /allowedValues must be an array of strings/);
});

test('two actions with the same id are refused', () => {
  const r = parseRulePack(pack({ actions: [action(), action({ title: 'A different title' })] }));
  assert.equal(r.ok, false);
  assert.match(r.error, /duplicate action ids/);
});

test('a pack with no actions at all is valid — it simply permits nothing', () => {
  // This is a legitimate posture, and the editor can now produce it by removing
  // every action. Gatekeeper still correlates, diagnoses and holds; R01 refuses
  // every action an agent proposes.
  assert.equal(parseRulePack(pack({ actions: [] })).ok, true);
});

test('saveRulePack refuses to persist an invalid pack rather than storing it', async () => {
  const store = memStore();
  await assert.rejects(
    () => saveRulePack(store, pack({ actions: [action({ effect: 'delete' })] })),
    /refusing to save an invalid rule pack/,
  );
  assert.equal(store.map.size, 0, 'nothing may be written when validation fails');
});

test('a saved pack round-trips through storage unchanged', async () => {
  const store = memStore();
  const saved = await saveRulePack(store, pack({ actions: [action()], version: 3 }));
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.actions, [action()]);
});

// ---------------------------------------------------------------------------
// Who changed the rules. Until this existed, Gatekeeper recorded every action a
// robot took and nothing about the person who decided what robots may do.
// ---------------------------------------------------------------------------

const commit = (store, over = {}) =>
  commitRulePack(store, { actor: 'user:alice', now: '2026-11-19T22:00:00.000Z', ...over });

test('a change is recorded on the project chain, naming the person and the version', async () => {
  const store = memStore();
  const r = await commit(store, { pack: pack({ unattendedAllowed: true }) });

  assert.equal(r.rulePack.version, 2);
  assert.equal(r.receipt.actor, 'user:alice');
  assert.equal(r.receipt.event, RECEIPT_EVENT.RULEPACK_CHANGED);
  assert.equal(r.receipt.rulePackVersion, 2);
  assert.match(r.receipt.reason, /v1 → v2/);
});

test('the record says WHICH rules were saved, not merely that a save happened', async () => {
  // The receipt's evidenceDigest is the pack's own digest, so a change record
  // can be tied back to an exact set of rules.
  const store = memStore();
  const next = pack({ unattendedAllowed: true });
  const r = await commit(store, { pack: next });
  assert.equal(r.receipt.evidenceDigest, digestRulePack(r.rulePack));
});

test('widening is called out, because that is the question anyone asks later', async () => {
  const store = memStore();
  const r = await commit(store, { pack: pack({ unattendedAllowed: true, confidenceFloor: 0.5 }) });
  assert.match(r.receipt.reason, /WIDENS \(2\)/);
  assert.match(r.receipt.reason, /unattended action switched ON/);
  assert.match(r.receipt.reason, /confidence floor 0\.75 → 0\.5/);
});

test('tightening is recorded but not flagged as widening', async () => {
  const store = memStore();
  const r = await commit(store, { pack: pack({ confidenceFloor: 0.95 }) });
  assert.equal(r.changes.every((c) => c.widens === false), true);
  assert.doesNotMatch(r.receipt.reason, /WIDENS/);
});

test('the chain of changes verifies, and tampering with an entry breaks it', async () => {
  const store = memStore();
  await commit(store, { pack: pack({ unattendedAllowed: true }) });
  await commit(store, { pack: pack({ unattendedAllowed: true, confidenceFloor: 0.5 }), actor: 'user:bob' });

  const { chain, verification } = await readRulePackHistory(store, 'NW');
  assert.equal(verification.ok, true);
  assert.equal(chain.length, 2);
  assert.equal(chain[0].actor, 'user:bob', 'newest first');

  // Rewrite history: make it look as though nobody ever switched it on.
  const key = `receipt:rulepack:NW:000000`;
  const edited = await store.get(key);
  edited.reason = 'v1 → v2. Nothing of consequence.';
  await store.set(key, edited);

  const after = await readRulePackHistory(store, 'NW');
  assert.equal(after.verification.ok, false);
  assert.equal(after.verification.at, '000000');
});

test('a save that changes no rule is refused rather than written', async () => {
  // A version bump makes every pending verdict stale. Spending that on a no-op
  // costs a human a re-run for nothing.
  const store = memStore();
  const r = await commit(store, { pack: pack() });
  assert.equal(r.changes.length, 0);
  assert.equal(r.receipt, null);
  assert.equal(r.rulePack.version, 1, 'the version must not move');
  assert.equal((await readRulePackHistory(store, 'NW')).chain.length, 0);
});

test('a lost update is refused: two tabs, one opened before the other saved', async () => {
  const store = memStore();
  await commit(store, { pack: pack({ unattendedAllowed: true }) }); // now at v2

  // Bob is still editing v1 in another tab and tries to save.
  await assert.rejects(
    () => commit(store, { pack: pack({ confidenceFloor: 0.1 }), basedOnVersion: 1, actor: 'user:bob' }),
    (e) => {
      assert.equal(e.conflict, true);
      assert.equal(e.current.version, 2);
      assert.match(e.message, /edited elsewhere/);
      return true;
    },
  );

  // And nothing of Bob's was written.
  const live = await loadRulePack(store, 'NW');
  assert.equal(live.confidenceFloor, 0.75);
  assert.equal(live.unattendedAllowed, true, "alice's change survived");
});

test('a save based on the current version goes through', async () => {
  const store = memStore();
  const r = await commit(store, { pack: pack({ unattendedAllowed: true }), basedOnVersion: 1 });
  assert.equal(r.rulePack.version, 2);
});

// --- the diff itself --------------------------------------------------------

const diff = (before, after) => summariseRulePackChange(before, after);
const widens = (before, after, re) => {
  const hit = diff(before, after).find((c) => re.test(c.text));
  assert.ok(hit, `no change matched ${re}`);
  return hit.widens;
};

test('clearing permitted values reads as a widening, not a tightening', () => {
  // The trap: an empty list means ANY value. A diff that reports "3 values → 0"
  // as a reduction tells the auditor the exact opposite of what happened.
  const before = pack({ actions: [action({ allowedValues: ['Triage', 'Resolved'] })] });
  const after = pack({ actions: [action({ allowedValues: [] })] });
  assert.equal(widens(before, after, /permitted values cleared/), true);
  assert.match(diff(before, after)[0].text, /R02 now allows ANY value/);
});

test('clearing an action for unattended use widens; capping it does not', () => {
  const held = pack({ actions: [action({ maxDisposition: DISPOSITION.HOLD })] });
  const auto = pack({ actions: [action({ maxDisposition: DISPOSITION.AUTO })] });
  assert.equal(widens(held, auto, /cleared for unattended use/), true);
  assert.equal(widens(auto, held, /capped at hold/), false);
});

test('adding an action widens, removing one does not', () => {
  const before = pack({ actions: [] });
  const after = pack({ actions: [action()] });
  assert.equal(widens(before, after, /added action/), true);
  assert.equal(widens(after, before, /removed action/), false);
});

test('dropping a priority from the human-only list widens', () => {
  const before = pack({ requireHumanPriorities: ['Highest', 'High'] });
  const after = pack({ requireHumanPriorities: ['Highest'] });
  assert.equal(widens(before, after, /always go to a human/), true);
  assert.equal(widens(after, before, /always go to a human/), false);
});

test('marking an irreversible action reversible widens, because R10 stops holding it', () => {
  const before = pack({ actions: [action({ reversible: false })] });
  const after = pack({ actions: [action({ reversible: true })] });
  assert.equal(widens(before, after, /reversible/), true);
});

test('removing a maintenance window widens, because R11 stops holding inside it', () => {
  const w = { label: 'patching', startsAt: '2026-11-19T00:00:00Z', endsAt: '2026-11-19T06:00:00Z' };
  const before = pack({ maintenanceWindows: [w] });
  const after = pack({ maintenanceWindows: [] });
  assert.equal(widens(before, after, /maintenance windows/), true);
});

test('adding a known-benign signature widens, since it closes alerts without a human', () => {
  const before = pack({ benignSignatures: [] });
  const after = pack({ benignSignatures: ['scheduled backup verification'] });
  assert.equal(widens(before, after, /known-benign signatures/), true);
});

test('a rename is recorded and is not a widening', () => {
  const before = pack({ name: 'old' });
  const after = pack({ name: 'new' });
  assert.equal(widens(before, after, /renamed/), false);
});

test('the pack digest ignores the version, so it answers "are these the same rules?"', () => {
  assert.equal(digestRulePack(pack({ version: 1 })), digestRulePack(pack({ version: 99 })));
  assert.notEqual(digestRulePack(pack()), digestRulePack(pack({ confidenceFloor: 0.9 })));
});
