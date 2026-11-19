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

import { DISPOSITION, EFFECT, parseRulePack } from '../src/shared/contracts.js';
import { defaultRulePack, demoRulePacks, saveRulePack } from '../src/gate/rulepack.js';
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
