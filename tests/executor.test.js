import test from 'node:test';
import assert from 'node:assert/strict';

import { DISPOSITION, RECEIPT_EVENT } from '../src/shared/contracts.js';
import { decide } from '../src/gate/gate.js';
import { execute, overrideAndExecute } from '../src/executor.js';
import { readChain, verifyChain } from '../src/gate/receipts.js';
import { NOW, bundleFor, incident, memStore, openPack, proposalFor, reviewConfirm, spyEffects } from './helpers.js';

function setup(over = {}) {
  const rulePack = over.rulePack ?? openPack();
  const bundle = over.bundle ?? bundleFor(over.incident ?? incident(), { rulePack });
  const proposal = over.proposal ?? proposalFor(bundle);
  const review = over.review ?? reviewConfirm();
  const verdict = decide({ proposal, review, bundle, rulePack, now: NOW });
  return { rulePack, bundle, proposal, review, verdict, store: memStore(), effects: spyEffects() };
}

test('an authorised action executes exactly one effect and leaves an executed receipt', async () => {
  const s = setup();
  assert.equal(s.verdict.disposition, DISPOSITION.AUTO, s.verdict.reason);

  const result = await execute({ ...s, now: NOW });

  assert.equal(result.executed, true);
  assert.equal(s.effects.calls.length, 1, 'exactly one effect, never two');
  assert.equal(s.effects.calls[0].name, 'comment');
  assert.deepEqual(s.effects.calls[0].args, ['NW-101', 'Triage: upstream pool exhausted.']);
  assert.equal(result.receipt.event, RECEIPT_EVENT.EXECUTED);
  assert.equal(result.receipt.actor, 'gatekeeper:executor');
  assert.equal(result.receipt.evidenceDigest, s.bundle.digest);
});

test('a held verdict executes nothing and leaves a held receipt carrying the proposal', async () => {
  const s = setup({ rulePack: openPack({ unattendedAllowed: false }) });
  assert.equal(s.verdict.disposition, DISPOSITION.HOLD);

  const result = await execute({ ...s, now: NOW });

  assert.equal(result.executed, false);
  assert.equal(s.effects.calls.length, 0, 'a hold must touch nothing');
  assert.equal(result.receipt.event, RECEIPT_EVENT.HELD);
  assert.ok(result.receipt.action, 'the proposal is preserved for whoever picks it up');
  assert.match(result.receipt.reason, /R04/);
});

test('a rejected verdict executes nothing and is recorded as rejected', async () => {
  const s = setup({ proposal: undefined });
  const bundle = s.bundle;
  const proposal = proposalFor(bundle, { action: { id: 'rm-rf-prod', params: {} } });
  const verdict = decide({ proposal, review: s.review, bundle, rulePack: s.rulePack, now: NOW });
  assert.equal(verdict.disposition, DISPOSITION.REJECT);

  const result = await execute({ ...s, proposal, verdict, now: NOW });

  assert.equal(result.executed, false);
  assert.equal(s.effects.calls.length, 0);
  assert.equal(result.receipt.event, RECEIPT_EVENT.REJECTED);
});

// --- the property the whole file exists for --------------------------------

test('a FORGED verdict cannot cause an action', async () => {
  // The gate held this. Someone then hands the executor a verdict that claims
  // it was authorised. The executor re-derives and refuses.
  const s = setup({ rulePack: openPack({ unattendedAllowed: false }) });
  assert.equal(s.verdict.disposition, DISPOSITION.HOLD);

  const forged = { ...s.verdict, disposition: DISPOSITION.AUTO, reason: 'approved' };
  const result = await execute({ ...s, verdict: forged, now: NOW });

  assert.equal(result.executed, false);
  assert.equal(s.effects.calls.length, 0, 'nothing may happen on a forged verdict');
  assert.equal(result.receipt.event, RECEIPT_EVENT.REJECTED);
  assert.match(result.reason, /does not match the one re-derived/);
});

test('a verdict replayed against a newer rule pack is refused', async () => {
  // Authorised under the old pack; the project has since switched unattended
  // action off. Replaying the old verdict must not act under the old rules.
  const s = setup();
  assert.equal(s.verdict.disposition, DISPOSITION.AUTO);

  const tightened = openPack({ unattendedAllowed: false, version: 8 });
  const result = await execute({ ...s, rulePack: tightened, now: NOW });

  assert.equal(result.executed, false);
  assert.equal(s.effects.calls.length, 0);
  assert.match(result.reason, /does not match the one re-derived/);
});

test('a verdict about a stale view of the issue is refused', async () => {
  const s = setup();
  // The issue changed after the verdict was reached.
  const moved = bundleFor(incident({ summary: 'api-gateway recovered on its own' }), { rulePack: s.rulePack });
  const result = await execute({ ...s, bundle: moved, now: NOW });

  assert.equal(result.executed, false);
  assert.equal(s.effects.calls.length, 0);
});

test('the executor refuses an action capped at hold even if a verdict says auto', async () => {
  // Belt and braces on top of the re-derive: the ceiling is re-read from the
  // rule pack at execution time. Constructed so the gate itself would pass,
  // then the ceiling is tightened underneath it.
  const s = setup();
  const tightened = {
    ...s.rulePack,
    actions: s.rulePack.actions.map((a) =>
      a.id === 'comment-triage-summary' ? { ...a, maxDisposition: DISPOSITION.HOLD } : a,
    ),
  };
  const result = await execute({ ...s, rulePack: tightened, now: NOW });
  assert.equal(result.executed, false, 'the tightened ceiling must hold it');
  assert.equal(s.effects.calls.length, 0);
});

test('an action missing a required parameter throws instead of silently doing nothing', async () => {
  const s = setup({ proposal: undefined });
  const proposal = proposalFor(s.bundle, { action: { id: 'comment-triage-summary', params: {} } });
  const verdict = decide({ proposal, review: s.review, bundle: s.bundle, rulePack: s.rulePack, now: NOW });
  assert.equal(verdict.disposition, DISPOSITION.AUTO);

  await assert.rejects(() => execute({ ...s, proposal, verdict, now: NOW }), /requires a "body" parameter/);
  assert.equal(s.effects.calls.length, 0);
});

test('an effect the executor does not implement is refused, not ignored', async () => {
  const s = setup({ proposal: undefined });
  const pack = {
    ...s.rulePack,
    actions: [
      ...s.rulePack.actions,
      { id: 'page-pagerduty', title: 'Page', effect: 'webhook', maxDisposition: DISPOSITION.AUTO, reversible: true },
    ],
  };
  const bundle = bundleFor(incident(), { rulePack: pack });
  const proposal = proposalFor(bundle, { action: { id: 'page-pagerduty', params: {} } });
  const verdict = decide({ proposal, review: s.review, bundle, rulePack: pack, now: NOW });

  await assert.rejects(
    () => execute({ ...s, bundle, proposal, verdict, rulePack: pack, now: NOW }),
    /unknown effect "webhook"/,
  );
  assert.equal(s.effects.calls.length, 0);
});

// --- human override ---------------------------------------------------------

test('a human may take an action the gate held, and it is recorded as theirs', async () => {
  const s = setup({ rulePack: openPack({ unattendedAllowed: false }) });
  assert.equal(s.verdict.disposition, DISPOSITION.HOLD);

  const result = await overrideAndExecute({ ...s, accountId: 'acc-123', now: NOW });

  assert.equal(result.executed, true);
  assert.equal(s.effects.calls.length, 1);
  assert.equal(result.receipt.event, RECEIPT_EVENT.OVERRIDDEN);
  assert.equal(result.receipt.actor, 'user:acc-123', 'the chain must say who acted');
});

test('a human may NOT override a rejected action', async () => {
  // Reject means the action is outside the allow-list, or the proposal is about
  // a view of the issue that no longer exists. A one-click override is not the
  // right escape hatch for either.
  const s = setup({ proposal: undefined });
  const proposal = proposalFor(s.bundle, { action: { id: 'drop-table', params: {} } });
  const verdict = decide({ proposal, review: s.review, bundle: s.bundle, rulePack: s.rulePack, now: NOW });
  assert.equal(verdict.disposition, DISPOSITION.REJECT);

  await assert.rejects(
    () => overrideAndExecute({ ...s, verdict, accountId: 'acc-123', now: NOW }),
    /cannot authorise a rejected action/,
  );
  assert.equal(s.effects.calls.length, 0);
});

test('a human may NOT override a reject whose action IS in the rule pack', async () => {
  // The case the ordering bug let through: rejected for a stale evidence digest,
  // not for an unknown action. The lookup would have passed, so the reject check
  // has to come first or the override reaches the effect.
  const s = setup({ proposal: undefined });
  const proposal = proposalFor(s.bundle, { evidenceDigest: 'f'.repeat(64) });
  const verdict = decide({ proposal, review: s.review, bundle: s.bundle, rulePack: s.rulePack, now: NOW });
  assert.equal(verdict.disposition, DISPOSITION.REJECT);
  assert.ok(
    s.rulePack.actions.some((a) => a.id === verdict.action.id),
    'this test is only meaningful if the action is a known one',
  );

  await assert.rejects(
    () => overrideAndExecute({ ...s, verdict, accountId: 'acc-123', now: NOW }),
    /cannot authorise a rejected action/,
  );
  assert.equal(s.effects.calls.length, 0);
});

test('an override with nothing to execute is refused', async () => {
  const s = setup();
  await assert.rejects(
    () => overrideAndExecute({ ...s, verdict: { ...s.verdict, action: null }, accountId: 'a', now: NOW }),
    /nothing to override/,
  );
});

// --- the chain across a whole incident -------------------------------------

test('a held-then-overridden incident leaves an intact, readable chain', async () => {
  const s = setup({ rulePack: openPack({ unattendedAllowed: false }) });

  await execute({ ...s, now: NOW });
  await overrideAndExecute({ ...s, accountId: 'acc-9', now: '2026-11-19T18:05:00.000Z' });

  const chain = await readChain(s.store, s.bundle.issueKey);
  assert.equal(chain.length, 2);
  assert.deepEqual(chain.map((r) => r.event), [RECEIPT_EVENT.HELD, RECEIPT_EVENT.OVERRIDDEN]);
  assert.deepEqual(chain.map((r) => r.actor), ['gatekeeper:executor', 'user:acc-9']);
  assert.equal(verifyChain(chain).ok, true);

  // Every receipt records which rule pack version decided, so a later audit can
  // tell "the rules allowed this then" from "the rules allow this now".
  for (const r of chain) assert.equal(r.rulePackVersion, s.rulePack.version);
});
