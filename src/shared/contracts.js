/**
 * contracts.js — FROZEN. Every type and shape in Gatekeeper is defined here.
 *
 * Import from this file. Do not edit it without telling the integrator: the gate,
 * the executor, the agent actions and the panel all read these shapes, and a
 * silent change to one of them is how a safety check stops checking.
 *
 * The design rule this file exists to enforce:
 *
 *   The model proposes.  Deterministic code decides.  Nothing executes without a receipt.
 *
 * So an AgentProposal is never authority. A GateVerdict is the only thing that
 * authorises anything, the executor re-derives it rather than trusting it, and
 * every execution emits a Receipt linked to the one before it.
 */

// ---------------------------------------------------------------------------
// Trust levels. Written down because the whole architecture turns on them.
// ---------------------------------------------------------------------------

export const TRUST = {
  /** Deterministic, no model, no network. May decide. */
  TRUSTED: 'trusted',
  /** Model output. Load-bearing, but never authority. */
  UNTRUSTED: 'untrusted',
};

// ---------------------------------------------------------------------------
// Evidence — facts gathered deterministically from Jira before any model runs
// ---------------------------------------------------------------------------

/**
 * A single piece of evidence. `source: true` means it came from Jira itself and
 * may be quoted as corroboration. Anything produced by a model has
 * `source: false` and can never corroborate another model's claim — quoting a
 * diagnosis back at you is not a second opinion.
 *
 * @typedef {object} EvidenceItem
 * @property {string} id
 * @property {'field'|'comment'|'changelog'|'linked-issue'|'correlation'|'agent'} kind
 * @property {string} text      the verbatim text a model is allowed to see
 * @property {boolean} source   true = from Jira; false = produced by an agent
 * @property {string} [at]      ISO timestamp, when known
 */

/**
 * Everything the agents are allowed to see about one incident. Deterministic:
 * the same issue state in gives the same bundle out, and the same digest.
 *
 * @typedef {object} EvidenceBundle
 * @property {string} issueKey
 * @property {string} projectKey
 * @property {string} summary
 * @property {string} priority
 * @property {string} status
 * @property {EvidenceItem[]} items
 * @property {CorrelationResult} correlation
 * @property {string} digest    sha256 over the canonical bundle — what the agents saw
 */

// ---------------------------------------------------------------------------
// Correlation — deterministic, fully trusted, runs before any model
// ---------------------------------------------------------------------------

/**
 * @typedef {object} CorrelationResult
 * @property {boolean} suppress           true = close without paging a human
 * @property {string|null} reason         a SUPPRESS_REASON. Never null when suppress is true.
 * @property {string[]} relatedIssueKeys
 * @property {number} signatureCount      how many issues share this signature in the window
 * @property {string} signature           the normalised fingerprint
 */

export const SUPPRESS_REASON = {
  DUPLICATE: 'duplicate',
  KNOWN_BENIGN: 'known-benign',
  MAINTENANCE_WINDOW: 'maintenance-window',
  FLAPPING: 'flapping',
};

// ---------------------------------------------------------------------------
// Agent output — UNTRUSTED. Four agents, each with one job.
// ---------------------------------------------------------------------------

export const AGENT = {
  TRIAGE: 'triage',
  DIAGNOSIS: 'diagnosis',
  REMEDIATION: 'remediation',
  REVIEWER: 'reviewer',
};

/**
 * What an agent hands back. `confidence` is the model's own number and is
 * treated as a claim, not a measurement: the gate applies a floor to it but
 * never trusts it on its own.
 *
 * @typedef {object} AgentProposal
 * @property {string} agent            one of AGENT
 * @property {string} issueKey
 * @property {string} evidenceDigest   which bundle this was reasoning over
 * @property {string} rationale
 * @property {number} confidence       0..1, self-reported
 * @property {string[]} quotes         verbatim strings the agent says it relied on
 * @property {ProposedAction|null} action
 */

/**
 * An action an agent would like taken. `id` must already exist in the project's
 * rule pack — an agent cannot invent an action, only choose from the allow-list
 * an admin authored.
 *
 * @typedef {object} ProposedAction
 * @property {string} id
 * @property {Record<string, string|number|boolean>} params
 */

/**
 * The reviewer's verdict. A reviewer that cites a quote absent from the SOURCE
 * evidence has fabricated its citation; verifyQuotes downgrades the verdict to
 * 'dissent' and the gate then holds for a human.
 *
 * @typedef {object} ReviewVerdict
 * @property {'confirm'|'dissent'} verdict
 * @property {string[]} quotes
 * @property {boolean} quotesVerified   set by deterministic code, never by a model
 * @property {string[]} unverifiedQuotes
 * @property {string} rationale
 */

// ---------------------------------------------------------------------------
// Rule pack — a project IS a rule pack. Onboarding a team means authoring one
// of these, not changing code.
// ---------------------------------------------------------------------------

export const DISPOSITION = {
  /** Refuse outright. Nothing happens, and the reason is written down. */
  REJECT: 'reject',
  /** A human decides. The proposal is preserved for them. */
  HOLD: 'hold',
  /** The executor may act, unattended. */
  AUTO: 'auto',
};

/**
 * One permitted action. `maxDisposition` is a ceiling: an action marked HOLD can
 * never be auto-executed however confident the model is, and that ceiling is
 * re-read by the executor at execution time rather than trusted from a verdict.
 *
 * @typedef {object} RuleAction
 * @property {string} id
 * @property {string} title
 * @property {'comment'|'transition'|'assign'|'link'|'label'} effect
 * @property {string} maxDisposition     DISPOSITION.HOLD or DISPOSITION.AUTO
 * @property {boolean} reversible
 * @property {string[]} [allowedValues]  e.g. permitted transition names
 */

/**
 * @typedef {object} MaintenanceWindow
 * @property {string} label
 * @property {string} startsAt   ISO
 * @property {string} endsAt     ISO
 * @property {string[]} [components]
 */

/**
 * @typedef {object} RulePack
 * @property {string} projectKey
 * @property {string} name
 * @property {number} version
 * @property {number} confidenceFloor          below this, a human. Default 0.75.
 * @property {RuleAction[]} actions
 * @property {string[]} benignSignatures       matched against the correlation signature
 * @property {MaintenanceWindow[]} maintenanceWindows
 * @property {number} duplicateWindowMinutes
 * @property {number} flapThreshold
 * @property {boolean} unattendedAllowed       master switch. false = nothing auto-executes.
 * @property {string[]} requireHumanPriorities e.g. ['Highest'] always holds
 */

// ---------------------------------------------------------------------------
// The gate's verdict — the ONLY thing that authorises an action
// ---------------------------------------------------------------------------

/**
 * @typedef {object} RuleOutcome
 * @property {string} rule     rule id, e.g. 'R04'
 * @property {string} title
 * @property {boolean} fired
 * @property {string} detail   written so a human can audit it without the code
 * @property {string} [forces] the DISPOSITION this rule forces when it fires
 */

/**
 * Note `rulePackVersion` and `evidenceDigest`: the executor checks both before
 * acting. A verdict produced against a different rule pack, or a different view
 * of the issue, is refused rather than replayed.
 *
 * @typedef {object} GateVerdict
 * @property {string} disposition      one of DISPOSITION
 * @property {string} issueKey
 * @property {string} projectKey
 * @property {number} rulePackVersion
 * @property {string} evidenceDigest
 * @property {ProposedAction|null} action
 * @property {RuleOutcome[]} outcomes  every rule, fired or not. Eleven, always.
 * @property {string} reason           the single sentence a human reads first
 * @property {string} decidedAt        ISO
 */

// ---------------------------------------------------------------------------
// Receipts — an append-only sha256 chain. Each links to the previous digest.
// ---------------------------------------------------------------------------

/**
 * @typedef {object} Receipt
 * @property {string} seq      monotonic, zero-padded so it sorts as a string
 * @property {string} issueKey
 * @property {string} actor    'gatekeeper:executor' or 'user:<accountId>'
 * @property {string} event    'suppressed'|'held'|'executed'|'rejected'|'overridden'
 * @property {string} evidenceDigest
 * @property {number} rulePackVersion
 * @property {ProposedAction|null} action
 * @property {string} reason
 * @property {string} at       ISO
 * @property {string} prev     previous receipt digest, or GENESIS
 * @property {string} digest   sha256 over this receipt with `digest` omitted
 */

export const GENESIS = 'GENESIS';

/**
 * The first characters of every receipt comment Gatekeeper posts.
 *
 * It is a shared constant because two places must agree on it exactly:
 * renderReceipt writes it, and buildBundle uses it to keep our own receipts OUT
 * of the evidence bundle. If they ever disagree, the bundle starts including our
 * commentary, the digest moves every time we post a receipt, and every pending
 * proposal is rejected under R03 — which is precisely the bug this constant
 * exists to prevent.
 */
export const RECEIPT_MARKER = '*Gatekeeper \u00b7 ';

export const RECEIPT_EVENT = {
  SUPPRESSED: 'suppressed',
  HELD: 'held',
  EXECUTED: 'executed',
  REJECTED: 'rejected',
  OVERRIDDEN: 'overridden',
  /**
   * The gate authorised the action and the effect then failed — Jira refused the
   * transition, the API was down, a parameter was wrong.
   *
   * This exists because the claim is "nothing is attempted without a receipt",
   * not "nothing succeeds without a receipt". Without it, an authorised action
   * that failed halfway leaves no trace, and the gap in the chain is exactly
   * where an operator most needs to know what was tried.
   */
  FAILED: 'failed',
};

// ---------------------------------------------------------------------------
// Storage keys. One place, so two lanes cannot disagree about them.
// ---------------------------------------------------------------------------

export const KEY = {
  rulePack: (projectKey) => `rulepack:${projectKey}`,
  receiptHead: (issueKey) => `receipt-head:${issueKey}`,
  receipt: (issueKey, seq) => `receipt:${issueKey}:${seq}`,
  verdict: (issueKey) => `verdict:${issueKey}`,
  run: (issueKey) => `run:${issueKey}`,
};

// ---------------------------------------------------------------------------
// Validators. Deterministic code must never assume a model returned the shape
// it was asked for, so these run on every agent response.
// ---------------------------------------------------------------------------

/**
 * @param {unknown} v
 * @returns {{ok: true, value: AgentProposal} | {ok: false, error: string}}
 */
export function parseAgentProposal(v) {
  if (typeof v !== 'object' || v === null) return { ok: false, error: 'not an object' };
  const o = v;

  if (typeof o.agent !== 'string' || !Object.values(AGENT).includes(o.agent)) {
    return { ok: false, error: `unknown agent: ${String(o.agent)}` };
  }
  if (typeof o.rationale !== 'string' || o.rationale.length === 0) {
    return { ok: false, error: 'rationale must be a non-empty string' };
  }
  if (typeof o.confidence !== 'number' || !Number.isFinite(o.confidence)) {
    return { ok: false, error: 'confidence must be a finite number' };
  }
  // A model that returns 1.5 is not clipped quietly. A confidence outside the
  // range means the response is malformed, and a malformed response is refused
  // rather than repaired into something plausible.
  if (o.confidence < 0 || o.confidence > 1) {
    return { ok: false, error: `confidence out of range: ${o.confidence}` };
  }
  if (!Array.isArray(o.quotes) || o.quotes.some((q) => typeof q !== 'string')) {
    return { ok: false, error: 'quotes must be an array of strings' };
  }
  if (o.action !== null && o.action !== undefined) {
    const a = o.action;
    if (typeof a !== 'object') return { ok: false, error: 'action must be an object or null' };
    if (typeof a.id !== 'string' || a.id.length === 0) return { ok: false, error: 'action.id required' };
    if (a.params !== undefined && (typeof a.params !== 'object' || a.params === null)) {
      return { ok: false, error: 'action.params must be an object' };
    }
  }

  return {
    ok: true,
    value: {
      agent: o.agent,
      issueKey: typeof o.issueKey === 'string' ? o.issueKey : '',
      evidenceDigest: typeof o.evidenceDigest === 'string' ? o.evidenceDigest : '',
      rationale: o.rationale,
      confidence: o.confidence,
      quotes: o.quotes,
      action: o.action ? { id: o.action.id, params: o.action.params ?? {} } : null,
    },
  };
}

/**
 * A rule pack arriving from storage or an admin form is validated the same way.
 * @param {unknown} v
 * @returns {{ok: true, value: RulePack} | {ok: false, error: string}}
 */
export function parseRulePack(v) {
  if (typeof v !== 'object' || v === null) return { ok: false, error: 'not an object' };
  const o = v;
  if (typeof o.projectKey !== 'string' || !o.projectKey) return { ok: false, error: 'projectKey required' };
  if (typeof o.version !== 'number' || !Number.isInteger(o.version)) {
    return { ok: false, error: 'version must be an integer' };
  }
  if (typeof o.confidenceFloor !== 'number' || o.confidenceFloor < 0 || o.confidenceFloor > 1) {
    return { ok: false, error: 'confidenceFloor must be between 0 and 1' };
  }
  if (!Array.isArray(o.actions)) return { ok: false, error: 'actions must be an array' };
  for (const a of o.actions) {
    if (typeof a?.id !== 'string' || !a.id) return { ok: false, error: 'every action needs an id' };
    if (a.maxDisposition !== DISPOSITION.HOLD && a.maxDisposition !== DISPOSITION.AUTO) {
      return { ok: false, error: `action ${a.id}: maxDisposition must be hold or auto` };
    }
  }
  const ids = o.actions.map((a) => a.id);
  if (new Set(ids).size !== ids.length) return { ok: false, error: 'duplicate action ids' };
  if (typeof o.unattendedAllowed !== 'boolean') return { ok: false, error: 'unattendedAllowed must be a boolean' };
  return { ok: true, value: o };
}
