/**
 * gate.js — deterministic, fully trusted. The only thing in Gatekeeper that may
 * authorise an action.
 *
 * `decide()` is a pure function: no network, no storage, no clock. `now` is an
 * argument. Give it the same inputs and it returns the same verdict, byte for
 * byte, which is what makes the receipt chain worth anything.
 *
 * Twelve rules. All twelve are evaluated on every decision, including the ones
 * that do not fire, and all twelve appear in the verdict. That is not for show:
 * an operator reading a held incident needs to see the rules that *passed* to
 * know the hold was specific rather than a blanket refusal, and a rule that
 * silently stops being evaluated is the classic way a safety check rots.
 *
 * Precedence: REJECT beats HOLD beats AUTO. Rules R01–R03 reject; R04–R12 hold.
 * Nothing here can escalate a proposal — the gate can only ever make the
 * outcome more conservative than the agent asked for.
 *
 * Rule ids are APPEND-ONLY. R12 checks the proposer's citations and belongs
 * beside R08, which checks the reviewer's, but it is numbered last rather than
 * inserted there: every receipt already written names the rules that fired as
 * bare ids, so renumbering R09–R11 would silently change what the existing
 * audit trail says happened. A gap in the logical ordering is a much smaller
 * cost than a chain of receipts that now reads wrong.
 */

import { DISPOSITION } from '../shared/contracts.js';
import { verifyQuotes } from './evidence.js';

/** The rule ids, in evaluation order, so tests can assert the set is intact. */
export const RULE_IDS = ['R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R12'];

/**
 * @param {object} args
 * @param {import('../shared/contracts.js').AgentProposal|null} args.proposal   already parsed; never raw model output
 * @param {import('../shared/contracts.js').ReviewVerdict|null} [args.review]
 * @param {import('../shared/contracts.js').EvidenceBundle} args.bundle
 * @param {import('../shared/contracts.js').RulePack} args.rulePack
 * @param {string} args.now  ISO
 * @returns {import('../shared/contracts.js').GateVerdict}
 */
export function decide({ proposal, review = null, bundle, rulePack, now }) {
  /** @type {import('../shared/contracts.js').RuleOutcome[]} */
  const outcomes = [];
  const add = (rule, title, fired, detail, forces) =>
    outcomes.push(forces && fired ? { rule, title, fired, detail, forces } : { rule, title, fired, detail });

  const action = proposal?.action ?? null;
  const known = action ? (rulePack.actions || []).find((a) => a.id === action.id) : null;

  // -- R01 -----------------------------------------------------------------
  // An agent may only choose from the allow-list an admin authored. An action
  // id that is not in the rule pack means the model invented a capability, and
  // inventing capabilities is refused outright rather than held for review.
  add(
    'R01',
    'Action exists in the rule pack',
    Boolean(action) && !known,
    action
      ? known
        ? `"${action.id}" is in the rule pack for ${rulePack.projectKey}`
        : `"${action.id}" is not in the rule pack for ${rulePack.projectKey} — the agent invented it`
      : 'no action proposed',
    DISPOSITION.REJECT,
  );

  // -- R02 -----------------------------------------------------------------
  // Parameter values are checked against the allow-list too. An action may be
  // permitted while a particular value of it is not: "transition this issue" is
  // fine, "transition it to Closed" may not be.
  const badParams = [];
  if (action && known && Array.isArray(known.allowedValues) && known.allowedValues.length > 0) {
    for (const [k, v] of Object.entries(action.params || {})) {
      if (!known.allowedValues.includes(String(v))) badParams.push(`${k}=${String(v)}`);
    }
  }
  add(
    'R02',
    'Action parameters are permitted values',
    badParams.length > 0,
    badParams.length > 0
      ? `not permitted for "${action.id}": ${badParams.join(', ')}; allowed: ${known.allowedValues.join(', ')}`
      : 'all parameters within the permitted set',
    DISPOSITION.REJECT,
  );

  // -- R03 -----------------------------------------------------------------
  // The proposal must be about the issue state we actually hold. A digest
  // mismatch means the agent reasoned over a different view — the issue moved
  // underneath it, or the proposal is being replayed — so the conclusion is
  // about a situation that no longer exists.
  const digestMismatch = Boolean(proposal) && proposal.evidenceDigest !== bundle.digest;
  add(
    'R03',
    'Proposal matches the evidence we hold',
    digestMismatch,
    digestMismatch
      ? `proposal cites ${short(proposal.evidenceDigest)}, current evidence is ${short(bundle.digest)}`
      : `evidence digest ${short(bundle.digest)}`,
    DISPOSITION.REJECT,
  );

  // -- R04 -----------------------------------------------------------------
  // The master switch. When a project has not opted into unattended action,
  // nothing auto-executes regardless of how the rest of the rules score.
  const unattendedOff = rulePack.unattendedAllowed !== true;
  add(
    'R04',
    'Project allows unattended action',
    unattendedOff,
    unattendedOff
      ? `unattended action is switched off for ${rulePack.projectKey}`
      : `unattended action is enabled for ${rulePack.projectKey}`,
    DISPOSITION.HOLD,
  );

  // -- R05 -----------------------------------------------------------------
  // Per-action ceiling. An action the admin marked `hold` can never be
  // auto-executed, however confident the model is. This is the knob a team
  // actually turns: restart a worker unattended, never touch the database.
  const ceilingHold = Boolean(known) && known.maxDisposition === DISPOSITION.HOLD;
  add(
    'R05',
    'Action is cleared for unattended use',
    ceilingHold,
    known
      ? ceilingHold
        ? `"${known.id}" is capped at hold by the rule pack`
        : `"${known.id}" is cleared for auto`
      : 'no known action to check',
    DISPOSITION.HOLD,
  );

  // -- R06 -----------------------------------------------------------------
  // The confidence floor. Note this is a floor on a self-reported number: it
  // catches a model that admits uncertainty, and does nothing about one that is
  // confidently wrong. R07–R08 are what cover that case, which is why the floor
  // is not the safety story on its own.
  const floor = rulePack.confidenceFloor ?? 0.75;
  const belowFloor = Boolean(proposal) && proposal.confidence < floor;
  add(
    'R06',
    'Confidence at or above the floor',
    belowFloor,
    proposal
      ? `confidence ${proposal.confidence.toFixed(2)} against a floor of ${floor.toFixed(2)}`
      : 'no proposal to score',
    DISPOSITION.HOLD,
  );

  // -- R07 -----------------------------------------------------------------
  // The adversarial reviewer is a separate agent, blind to the proposing
  // agent's confidence. Its job is to disagree when disagreement is warranted.
  //
  // A MISSING review fires this rule just as a dissent does. Passing an
  // unreviewed proposal would make the reviewer decorative — the one case where
  // review is skipped is the case where nothing checked the proposal at all,
  // which is exactly when it is most needed.
  const dissent = review?.verdict === 'dissent';
  const unreviewed = !review;
  add(
    'R07',
    'Adversarial reviewer confirms',
    dissent || unreviewed,
    unreviewed
      ? 'no adversarial review on the record; nothing runs unattended without one'
      : dissent
        ? `reviewer dissented: ${review.rationale}`
        : 'reviewer confirmed',
    DISPOSITION.HOLD,
  );

  // -- R08 -----------------------------------------------------------------
  // Citation check. The reviewer's quotes are re-verified HERE, by this
  // deterministic code, against source evidence only — the review object's own
  // `quotesVerified` flag is never read, because a flag set upstream is exactly
  // as trustworthy as the thing that set it.
  //
  // This is the rule that caught a live model fabricating a quote to justify a
  // "confirm". See docs/EVIDENCE.md.
  const quoteCheck = review ? verifyQuotes(review.quotes, bundle) : { verified: true, unverified: [], checked: 0 };
  const fabricated = !quoteCheck.verified;
  add(
    'R08',
    'Reviewer citations appear in source evidence',
    fabricated,
    review
      ? fabricated
        ? `${quoteCheck.unverified.length} of ${quoteCheck.checked} citation(s) are not in the source evidence: ` +
          quoteCheck.unverified.map((q) => JSON.stringify(trim(q))).join(', ')
        : quoteCheck.checked === 0
          ? 'reviewer offered no citations, so there was nothing to fabricate'
          : `${quoteCheck.checked} citation(s) verified against source evidence`
      : 'no review performed',
    DISPOSITION.HOLD,
  );

  // -- R09 -----------------------------------------------------------------
  const humanPriorities = rulePack.requireHumanPriorities || [];
  const priorityHold = humanPriorities.includes(bundle.priority);
  add(
    'R09',
    'Priority does not mandate a human',
    priorityHold,
    priorityHold
      ? `priority ${bundle.priority} always goes to a human for ${rulePack.projectKey}`
      : `priority ${bundle.priority} is not on the human-only list`,
    DISPOSITION.HOLD,
  );

  // -- R10 -----------------------------------------------------------------
  // Irreversible actions hold even when everything else passes. The asymmetry
  // is the point: a held action costs a human five minutes, a wrong
  // irreversible one costs an outage nobody can undo.
  const irreversible = Boolean(known) && known.reversible === false;
  add(
    'R10',
    'Action is reversible',
    irreversible,
    known ? (irreversible ? `"${known.id}" is marked irreversible` : `"${known.id}" is reversible`) : 'no known action to check',
    DISPOSITION.HOLD,
  );

  // -- R11 -----------------------------------------------------------------
  // Correlation already suppresses alerts inside a maintenance window, so an
  // incident reaching the gate during one is unusual — it means something
  // decided this was worth attention anyway. Acting unattended in the middle of
  // planned work is how an automation fights a human who is mid-change.
  const inWindow = bundle.correlation?.reason === 'maintenance-window';
  add(
    'R11',
    'Not inside a maintenance window',
    inWindow,
    inWindow ? 'incident falls inside a declared maintenance window' : 'no active maintenance window',
    DISPOSITION.HOLD,
  );

  // -- R12 -----------------------------------------------------------------
  // The same citation check as R08, applied to the agent that wants to act.
  //
  // R08 alone left the obvious hole: it checked the reviewer's quotes and took
  // the proposer's on faith. A proposer is the one asking for an effect on a
  // real issue, so a fabricated citation there is the more consequential of the
  // two — it is the model manufacturing the grounds for its own action.
  //
  // This holds rather than rejects, for the same reason R08 does: the proposal
  // may still be right about the incident even where it was wrong about what
  // the evidence says, and a human reading the hold can see both the claim and
  // the quote that does not exist.
  const proposerQuotes = proposal ? verifyQuotes(proposal.quotes, bundle) : { verified: true, unverified: [], checked: 0 };
  const proposerFabricated = !proposerQuotes.verified;
  add(
    'R12',
    'Proposal citations appear in source evidence',
    proposerFabricated,
    proposal
      ? proposerFabricated
        ? `${proposerQuotes.unverified.length} of ${proposerQuotes.checked} citation(s) are not in the source evidence: ` +
          proposerQuotes.unverified.map((q) => JSON.stringify(trim(q))).join(', ')
        : proposerQuotes.checked === 0
          ? 'the agent cited nothing, so there was nothing to fabricate'
          : `${proposerQuotes.checked} citation(s) verified against source evidence`
      : 'no proposal to check',
    DISPOSITION.HOLD,
  );

  // -- resolve -------------------------------------------------------------
  const fired = outcomes.filter((o) => o.fired && o.forces);
  const rejecting = fired.filter((o) => o.forces === DISPOSITION.REJECT);
  const holding = fired.filter((o) => o.forces === DISPOSITION.HOLD);

  let disposition;
  let reason;

  if (!proposal) {
    disposition = DISPOSITION.HOLD;
    reason = 'No agent proposal; a human decides what to do.';
  } else if (rejecting.length > 0) {
    disposition = DISPOSITION.REJECT;
    reason = `Refused by ${rejecting.map((o) => o.rule).join(', ')}: ${rejecting[0].detail}`;
  } else if (!action) {
    disposition = DISPOSITION.HOLD;
    reason = 'The agent proposed no action, only a diagnosis; a human decides what to do.';
  } else if (holding.length > 0) {
    disposition = DISPOSITION.HOLD;
    reason = `Held by ${holding.map((o) => o.rule).join(', ')}: ${holding[0].detail}`;
  } else {
    disposition = DISPOSITION.AUTO;
    reason = `All twelve rules passed; "${action.id}" may run unattended.`;
  }

  return {
    disposition,
    issueKey: bundle.issueKey,
    projectKey: bundle.projectKey,
    rulePackVersion: rulePack.version,
    evidenceDigest: bundle.digest,
    action,
    outcomes,
    reason,
    decidedAt: now,
  };
}

/** @param {string} s */
function short(s) {
  return String(s || '').slice(0, 12);
}

/** @param {string} s */
function trim(s) {
  const t = String(s || '');
  return t.length > 80 ? `${t.slice(0, 77)}...` : t;
}
