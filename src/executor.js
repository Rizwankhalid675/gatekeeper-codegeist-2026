/**
 * executor.js — deterministic, fully trusted. The only code that touches Jira.
 *
 * The important property: **the executor does not trust the verdict it is
 * handed.** It re-runs the gate from the rule pack and the evidence, and acts
 * only on its own conclusion. A verdict that has been tampered with, replayed
 * from an older rule pack, or simply gone stale because the issue moved, is
 * refused — and the refusal is itself recorded as a receipt.
 *
 * That is not belt-and-braces. The verdict travels through storage and across
 * invocations, so "a forged verdict cannot cause an action" has to be a
 * property of this file, not an assumption about the ones before it.
 */

import { DISPOSITION, RECEIPT_EVENT } from './shared/contracts.js';
import { decide } from './gate/gate.js';
import { appendReceipt } from './gate/receipts.js';

/**
 * The effect map. An action's `effect` names one of these and nothing else —
 * there is no path from an agent's output to an arbitrary Jira call. Adding a
 * capability means adding a function here and an entry to a rule pack, both of
 * which are code review and admin configuration respectively.
 *
 * @typedef {object} Effects
 * @property {(issueKey: string, body: string) => Promise<void>} comment
 * @property {(issueKey: string, to: string) => Promise<void>} transition
 * @property {(issueKey: string, accountId: string) => Promise<void>} assign
 * @property {(issueKey: string, otherKey: string, type?: string) => Promise<void>} link
 * @property {(issueKey: string, label: string) => Promise<void>} label
 */

/**
 * @param {object} args
 * @param {import('./shared/contracts.js').GateVerdict} args.verdict   treated as a REQUEST, not an authorisation
 * @param {import('./shared/contracts.js').AgentProposal|null} args.proposal
 * @param {import('./shared/contracts.js').ReviewVerdict|null} args.review
 * @param {import('./shared/contracts.js').EvidenceBundle} args.bundle
 * @param {import('./shared/contracts.js').RulePack} args.rulePack
 * @param {Effects} args.effects
 * @param {import('./gate/receipts.js').Store} args.store
 * @param {string} args.now
 * @param {string} [args.actor]
 * @returns {Promise<{executed: boolean, receipt: import('./shared/contracts.js').Receipt, reason: string}>}
 */
export async function execute({
  verdict,
  proposal,
  review,
  bundle,
  rulePack,
  effects,
  store,
  now,
  actor = 'gatekeeper:executor',
}) {
  // 1. Re-derive. This is the whole point of the file: the authorisation used
  //    below is the one computed here and now, from the rule pack and the
  //    evidence, not the one that arrived in `verdict`.
  const rederived = decide({ proposal, review, bundle, rulePack, now });

  // 2. If the two disagree, something changed between decision and execution —
  //    a new rule pack version, an edited issue, or a verdict that did not come
  //    from this gate. Either way the safe move is to refuse and say so.
  if (rederived.disposition !== verdict.disposition || rederived.evidenceDigest !== verdict.evidenceDigest) {
    const reason =
      `Refused: the verdict presented does not match the one re-derived at execution time ` +
      `(presented ${verdict.disposition}/${verdict.evidenceDigest.slice(0, 12)}, ` +
      `re-derived ${rederived.disposition}/${rederived.evidenceDigest.slice(0, 12)}). ` +
      `Nothing was executed.`;
    const receipt = await appendReceipt(store, {
      issueKey: bundle.issueKey,
      actor,
      event: RECEIPT_EVENT.REJECTED,
      evidenceDigest: bundle.digest,
      rulePackVersion: rulePack.version,
      action: rederived.action,
      reason,
      at: now,
    });
    return { executed: false, receipt, reason };
  }

  // 3. Not cleared for unattended action. Record the hold so the proposal is
  //    preserved for whoever picks it up, with the rules that held it.
  if (rederived.disposition !== DISPOSITION.AUTO) {
    const event = rederived.disposition === DISPOSITION.REJECT ? RECEIPT_EVENT.REJECTED : RECEIPT_EVENT.HELD;
    const receipt = await appendReceipt(store, {
      issueKey: bundle.issueKey,
      actor,
      event,
      evidenceDigest: bundle.digest,
      rulePackVersion: rulePack.version,
      action: rederived.action,
      reason: rederived.reason,
      at: now,
    });
    return { executed: false, receipt, reason: rederived.reason };
  }

  const action = rederived.action;
  if (!action) {
    // decide() cannot return AUTO without an action; if it ever does, that is a
    // bug in the gate and this must not become a silent no-op that still logs
    // success.
    throw new Error('gate returned auto with no action — refusing to continue');
  }

  // 4. Re-read the action definition from the rule pack. Independent of the
  //    gate's own lookup: if the ceiling says hold, nothing auto-executes here
  //    even if every rule somehow passed.
  const known = (rulePack.actions || []).find((a) => a.id === action.id);
  if (!known) {
    throw new Error(`executor: "${action.id}" is not in the rule pack for ${rulePack.projectKey}`);
  }
  if (known.maxDisposition !== DISPOSITION.AUTO) {
    throw new Error(`executor: "${action.id}" is capped at ${known.maxDisposition} and may not run unattended`);
  }

  // 5. Perform exactly one allow-listed effect.
  //
  // A failure here is recorded before it is re-thrown. The alternative — letting
  // it propagate with nothing written — leaves an authorised action that was
  // attempted and failed with no trace in the chain, which is the one place an
  // operator most needs a record.
  try {
    await performEffect({ known, action, bundle, effects });
  } catch (e) {
    await appendReceipt(store, {
      issueKey: bundle.issueKey,
      actor,
      event: RECEIPT_EVENT.FAILED,
      evidenceDigest: bundle.digest,
      rulePackVersion: rulePack.version,
      action,
      reason: `Authorised by the gate, but the action failed: ${e.message}`,
      at: now,
    });
    throw e;
  }

  const receipt = await appendReceipt(store, {
    issueKey: bundle.issueKey,
    actor,
    event: RECEIPT_EVENT.EXECUTED,
    evidenceDigest: bundle.digest,
    rulePackVersion: rulePack.version,
    action,
    reason: rederived.reason,
    at: now,
  });

  return { executed: true, receipt, reason: rederived.reason };
}

/**
 * @param {object} args
 * @param {import('./shared/contracts.js').RuleAction} args.known
 * @param {import('./shared/contracts.js').ProposedAction} args.action
 * @param {import('./shared/contracts.js').EvidenceBundle} args.bundle
 * @param {Effects} args.effects
 */
async function performEffect({ known, action, bundle, effects }) {
  const p = action.params || {};
  const need = (name) => {
    const v = p[name];
    if (v === undefined || v === null || String(v).length === 0) {
      throw new Error(`executor: "${action.id}" requires a "${name}" parameter`);
    }
    return String(v);
  };

  switch (known.effect) {
    case 'comment':
      return effects.comment(bundle.issueKey, need('body'));
    case 'transition':
      return effects.transition(bundle.issueKey, need('to'));
    case 'assign':
      return effects.assign(bundle.issueKey, need('accountId'));
    case 'link':
      return effects.link(bundle.issueKey, need('otherKey'), p.type ? String(p.type) : undefined);
    case 'label':
      return effects.label(bundle.issueKey, need('label'));
    default:
      // An effect the executor does not implement is refused, not ignored. An
      // unknown effect that fell through to a no-op would report success while
      // doing nothing, which is worse than failing.
      throw new Error(`executor: unknown effect "${known.effect}" on action "${action.id}"`);
  }
}

/**
 * A human taking the action the gate held. Recorded as a distinct event with
 * the person's accountId as the actor, so the chain distinguishes "the robot
 * did this" from "a person overrode the robot".
 *
 * @param {object} args
 * @param {import('./shared/contracts.js').GateVerdict} args.verdict
 * @param {import('./shared/contracts.js').EvidenceBundle} args.bundle
 * @param {import('./shared/contracts.js').RulePack} args.rulePack
 * @param {Effects} args.effects
 * @param {import('./gate/receipts.js').Store} args.store
 * @param {string} args.accountId
 * @param {string} args.now
 */
export async function overrideAndExecute({ verdict, bundle, rulePack, effects, store, accountId, now }) {
  // A human may take an action the gate capped at `hold` — that is what hold
  // means. They may not take one the gate REJECTED: those are actions outside
  // the allow-list the admin authored, or proposals about a stale view of the
  // issue, and a one-click override is not the right way to escape either.
  //
  // This is checked FIRST, before the action is even looked up. Ordered the
  // other way, an invented action is refused for the incidental reason that it
  // is not in the rule pack, which is true but tells the operator the wrong
  // thing — and a verdict rejected for a stale digest carries an action that
  // IS in the pack, so it would sail past the lookup and reach the effect.
  if (verdict.disposition === DISPOSITION.REJECT) {
    throw new Error(`refused: ${verdict.reason} An override cannot authorise a rejected action.`);
  }

  const action = verdict.action;
  if (!action) throw new Error('nothing to override: the verdict carries no action');

  const known = (rulePack.actions || []).find((a) => a.id === action.id);
  if (!known) throw new Error(`"${action.id}" is not in the rule pack for ${rulePack.projectKey}`);

  // Same reasoning as execute(): a failed attempt is recorded, under the actor
  // who attempted it, before the error reaches them.
  try {
    await performEffect({ known, action, bundle, effects });
  } catch (e) {
    await appendReceipt(store, {
      issueKey: bundle.issueKey,
      actor: `user:${accountId}`,
      event: RECEIPT_EVENT.FAILED,
      evidenceDigest: bundle.digest,
      rulePackVersion: rulePack.version,
      action,
      reason: `Attempted by a human after Gatekeeper held it, and the action failed: ${e.message}`,
      at: now,
    });
    throw e;
  }

  const receipt = await appendReceipt(store, {
    issueKey: bundle.issueKey,
    actor: `user:${accountId}`,
    event: RECEIPT_EVENT.OVERRIDDEN,
    evidenceDigest: bundle.digest,
    rulePackVersion: rulePack.version,
    action,
    reason: `Executed by a human after Gatekeeper held it. ${verdict.reason}`,
    at: now,
  });

  return { executed: true, receipt };
}
