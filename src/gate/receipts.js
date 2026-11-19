/**
 * receipts.js — the append-only audit chain.
 *
 * Every decision Gatekeeper reaches writes one receipt: what it saw
 * (evidenceDigest), which rule pack version decided, what was done, who did it,
 * when, and the digest of the receipt before it. Change any earlier receipt and
 * every later digest stops matching, so `verifyChain` can tell you the history
 * has been edited rather than merely assuring you it hasn't.
 *
 * Storage is injected rather than imported. Forge's storage API is async and
 * only exists inside the Forge runtime; the gate's tests need the chain logic
 * without it. So this module takes `{ get, set }` and the Forge adapter lives
 * in src/platform/store.js.
 */

import { GENESIS, KEY, RECEIPT_EVENT } from '../shared/contracts.js';
import { canonicalJSON, sha256 } from './evidence.js';

/**
 * Receipts are numbered as zero-padded strings so that a lexicographic sort of
 * storage keys is also a chronological sort. Six digits is a million receipts
 * per issue, which is far more than an issue will ever see — but the padding
 * width is load-bearing, so it is a named constant rather than a literal.
 */
export const SEQ_WIDTH = 6;

/** @param {number} n */
export function seqOf(n) {
  return String(n).padStart(SEQ_WIDTH, '0');
}

/**
 * The digest covers the receipt with its own `digest` field removed — including
 * `prev`, which is what links the chain. Canonical JSON means key order cannot
 * change the hash.
 *
 * @param {Omit<import('../shared/contracts.js').Receipt, 'digest'>} receipt
 */
export function digestReceipt(receipt) {
  const { digest: _drop, ...rest } = /** @type {any} */ (receipt);
  return sha256(canonicalJSON(rest));
}

/**
 * @typedef {object} Store
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string, value: any) => Promise<void>} set
 */

/**
 * Append a receipt for `issueKey`.
 *
 * Not safe against two concurrent appends to the same issue — Forge storage has
 * no compare-and-swap, so a true race could give two receipts the same `seq`.
 * That is recorded in docs/LIMITS.md rather than papered over here. In practice
 * one issue is processed by one invocation, and `verifyChain` detects the
 * damage if it ever happens.
 *
 * @param {Store} store
 * @param {object} args
 * @param {string} args.issueKey
 * @param {string} args.actor
 * @param {string} args.event        one of RECEIPT_EVENT
 * @param {string} args.evidenceDigest
 * @param {number} args.rulePackVersion
 * @param {import('../shared/contracts.js').ProposedAction|null} args.action
 * @param {string} args.reason
 * @param {string} args.at           ISO
 * @returns {Promise<import('../shared/contracts.js').Receipt>}
 */
export async function appendReceipt(store, args) {
  if (!Object.values(RECEIPT_EVENT).includes(args.event)) {
    throw new Error(`unknown receipt event: ${args.event}`);
  }

  const head = (await store.get(KEY.receiptHead(args.issueKey))) || null;
  const nextIndex = head ? head.index + 1 : 0;

  /** @type {Omit<import('../shared/contracts.js').Receipt, 'digest'>} */
  const body = {
    seq: seqOf(nextIndex),
    issueKey: args.issueKey,
    actor: args.actor,
    event: args.event,
    evidenceDigest: args.evidenceDigest,
    rulePackVersion: args.rulePackVersion,
    action: args.action ?? null,
    reason: args.reason,
    at: args.at,
    prev: head ? head.digest : GENESIS,
  };

  const receipt = { ...body, digest: digestReceipt(body) };

  await store.set(KEY.receipt(args.issueKey, receipt.seq), receipt);
  await store.set(KEY.receiptHead(args.issueKey), { index: nextIndex, digest: receipt.digest });

  return receipt;
}

/**
 * @param {Store} store
 * @param {string} issueKey
 * @returns {Promise<import('../shared/contracts.js').Receipt[]>}
 */
export async function readChain(store, issueKey) {
  const head = await store.get(KEY.receiptHead(issueKey));
  if (!head) return [];
  const out = [];
  for (let i = 0; i <= head.index; i += 1) {
    const r = await store.get(KEY.receipt(issueKey, seqOf(i)));
    if (r) out.push(r);
  }
  return out;
}

/**
 * Verify a chain. Returns the first problem found rather than a boolean,
 * because "the audit log is broken" is useless without saying where.
 *
 * @param {import('../shared/contracts.js').Receipt[]} chain
 * @returns {{ok: true, length: number} | {ok: false, at: string, problem: string}}
 */
export function verifyChain(chain) {
  let prev = GENESIS;
  for (let i = 0; i < chain.length; i += 1) {
    const r = chain[i];

    if (r.seq !== seqOf(i)) {
      return { ok: false, at: r.seq, problem: `out of order: expected ${seqOf(i)}, found ${r.seq}` };
    }
    if (r.prev !== prev) {
      return { ok: false, at: r.seq, problem: `broken link: prev is ${r.prev}, previous digest was ${prev}` };
    }

    const recomputed = digestReceipt(r);
    if (recomputed !== r.digest) {
      return { ok: false, at: r.seq, problem: `digest mismatch: stored ${r.digest}, recomputed ${recomputed}` };
    }

    prev = r.digest;
  }
  return { ok: true, length: chain.length };
}

/**
 * The receipt rendered for the comment Gatekeeper leaves on the issue. An
 * operator should be able to audit a decision from the issue alone, without
 * opening the app or reading the code — so the rules that fired are named, not
 * summarised.
 *
 * @param {import('../shared/contracts.js').Receipt} receipt
 * @param {import('../shared/contracts.js').GateVerdict} verdict
 */
export function renderReceipt(receipt, verdict) {
  const firedRules = verdict.outcomes.filter((o) => o.fired);
  const lines = [
    `*Gatekeeper · ${receipt.event}*`,
    '',
    receipt.reason,
    '',
    `* action: ${receipt.action ? `\`${receipt.action.id}\`` : '_none_'}`,
    `* evidence: \`${receipt.evidenceDigest.slice(0, 12)}\``,
    `* rule pack: v${receipt.rulePackVersion}`,
    `* rules fired: ${firedRules.length ? firedRules.map((o) => o.rule).join(', ') : 'none — all eleven passed'}`,
    `* actor: ${receipt.actor}`,
    `* receipt: \`${receipt.digest.slice(0, 12)}\` (prev \`${receipt.prev.slice(0, 12)}\`)`,
  ];
  if (firedRules.length) {
    lines.push('');
    for (const o of firedRules) lines.push(`> ${o.rule} ${o.title} — ${o.detail}`);
  }
  return lines.join('\n');
}
