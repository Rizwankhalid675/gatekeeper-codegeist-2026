import test from 'node:test';
import assert from 'node:assert/strict';

import { GENESIS, KEY, RECEIPT_EVENT } from '../src/shared/contracts.js';
import { appendReceipt, digestReceipt, readChain, renderReceipt, seqOf, verifyChain } from '../src/gate/receipts.js';
import { decide } from '../src/gate/gate.js';
import { NOW, bundleFor, memStore, openPack, proposalFor, reviewConfirm } from './helpers.js';

const base = (over = {}) => ({
  issueKey: 'NW-101',
  actor: 'gatekeeper:executor',
  event: RECEIPT_EVENT.HELD,
  evidenceDigest: 'a'.repeat(64),
  rulePackVersion: 7,
  action: null,
  reason: 'because',
  at: NOW,
  ...over,
});

test('sequence numbers sort lexicographically as well as numerically', () => {
  const seqs = [0, 1, 2, 9, 10, 11, 100, 999999].map(seqOf);
  assert.deepEqual([...seqs].sort(), seqs, 'string sort must match append order');
});

test('the first receipt links to GENESIS', async () => {
  const store = memStore();
  const r = await appendReceipt(store, base());
  assert.equal(r.prev, GENESIS);
  assert.equal(r.seq, seqOf(0));
  assert.equal(r.digest.length, 64);
});

test('each receipt links to the digest of the one before it', async () => {
  const store = memStore();
  const a = await appendReceipt(store, base());
  const b = await appendReceipt(store, base({ event: RECEIPT_EVENT.EXECUTED }));
  const c = await appendReceipt(store, base({ event: RECEIPT_EVENT.OVERRIDDEN, actor: 'user:abc' }));

  assert.equal(b.prev, a.digest);
  assert.equal(c.prev, b.digest);
  assert.equal(verifyChain([a, b, c]).ok, true);
});

test('the head pointer tracks the latest receipt', async () => {
  const store = memStore();
  await appendReceipt(store, base());
  const second = await appendReceipt(store, base());
  const head = await store.get(KEY.receiptHead('NW-101'));
  assert.equal(head.index, 1);
  assert.equal(head.digest, second.digest);
});

test('readChain returns the receipts in order', async () => {
  const store = memStore();
  await appendReceipt(store, base({ reason: 'first' }));
  await appendReceipt(store, base({ reason: 'second' }));
  await appendReceipt(store, base({ reason: 'third' }));
  const chain = await readChain(store, 'NW-101');
  assert.deepEqual(chain.map((r) => r.reason), ['first', 'second', 'third']);
  assert.equal(verifyChain(chain).ok, true);
});

test('readChain on an issue with no history returns an empty chain', async () => {
  const store = memStore();
  assert.deepEqual(await readChain(store, 'NW-999'), []);
});

test('editing a receipt breaks the chain, and verifyChain says which one', async () => {
  const store = memStore();
  const a = await appendReceipt(store, base({ reason: 'held pending review' }));
  const b = await appendReceipt(store, base({ event: RECEIPT_EVENT.EXECUTED }));
  const chain = [a, b];

  // Rewrite history: make the first receipt claim something it did not say.
  chain[0] = { ...a, reason: 'approved by a human' };

  const result = verifyChain(chain);
  assert.equal(result.ok, false);
  assert.equal(result.at, seqOf(0));
  assert.match(result.problem, /digest mismatch/);
});

test('re-digesting an edited receipt still breaks the chain at the next link', async () => {
  // The subtler attack: edit the receipt AND fix its own digest. The link from
  // the following receipt is what catches it.
  const store = memStore();
  const a = await appendReceipt(store, base({ reason: 'held pending review' }));
  const b = await appendReceipt(store, base({ event: RECEIPT_EVENT.EXECUTED }));

  const forgedBody = { ...a, reason: 'approved by a human' };
  delete forgedBody.digest;
  const forged = { ...forgedBody, digest: digestReceipt(forgedBody) };

  assert.equal(verifyChain([forged]).ok, true, 'a one-receipt chain cannot detect this');

  const result = verifyChain([forged, b]);
  assert.equal(result.ok, false);
  assert.equal(result.at, seqOf(1));
  assert.match(result.problem, /broken link/);
});

test('dropping a receipt from the middle is detected', async () => {
  const store = memStore();
  const a = await appendReceipt(store, base());
  await appendReceipt(store, base());
  const c = await appendReceipt(store, base());

  const result = verifyChain([a, c]);
  assert.equal(result.ok, false);
  assert.match(result.problem, /out of order|broken link/);
});

test('reordering receipts is detected', async () => {
  const store = memStore();
  const a = await appendReceipt(store, base());
  const b = await appendReceipt(store, base());

  const result = verifyChain([b, a]);
  assert.equal(result.ok, false);
});

test('an empty chain verifies', () => {
  assert.deepEqual(verifyChain([]), { ok: true, length: 0 });
});

test('an unknown event is refused rather than written', async () => {
  const store = memStore();
  await assert.rejects(() => appendReceipt(store, base({ event: 'approved-probably' })), /unknown receipt event/);
  assert.equal(store.map.size, 0, 'nothing may be written when the event is unknown');
});

test('the digest is independent of key order', async () => {
  const body = base();
  delete body.digest;
  const reordered = Object.fromEntries(Object.entries(body).reverse());
  assert.equal(digestReceipt(body), digestReceipt(reordered));
});

test('the rendered comment names the rules that fired, so an operator can audit from the issue', async () => {
  const bundle = bundleFor();
  const verdict = decide({
    proposal: proposalFor(bundle, { confidence: 0.2 }),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  const store = memStore();
  const receipt = await appendReceipt(store, {
    issueKey: bundle.issueKey,
    actor: 'gatekeeper:executor',
    event: RECEIPT_EVENT.HELD,
    evidenceDigest: bundle.digest,
    rulePackVersion: openPack().version,
    action: verdict.action,
    reason: verdict.reason,
    at: NOW,
  });

  const text = renderReceipt(receipt, verdict);
  assert.match(text, /R06/, 'the rule that held it must be named');
  assert.match(text, /rules fired/);
  assert.match(text, new RegExp(receipt.digest.slice(0, 12)));
  assert.match(text, /prev/);
});

test('a clean verdict renders as all twelve passing, not as a blank', () => {
  const bundle = bundleFor();
  const verdict = decide({ proposal: proposalFor(bundle), review: reviewConfirm(), bundle, rulePack: openPack(), now: NOW });
  const receipt = {
    ...base({ event: RECEIPT_EVENT.EXECUTED, action: verdict.action, reason: verdict.reason }),
    seq: seqOf(0),
    prev: GENESIS,
    digest: 'd'.repeat(64),
  };
  assert.match(renderReceipt(receipt, verdict), /all twelve passed/);
});
