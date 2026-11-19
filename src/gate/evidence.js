/**
 * evidence.js — deterministic, fully trusted. No model calls, no network, no clock.
 *
 * Three jobs:
 *   1. canonicalise and digest an evidence bundle, so "what the agents saw" is a
 *      hash you can compare rather than a claim;
 *   2. correlate — decide what deserves a human's attention at all, which is
 *      where most of the noise reduction actually happens;
 *   3. verify quotes against SOURCE evidence only.
 *
 * Everything here is a pure function of its arguments. `now` is always passed
 * in, never read from the clock, so a test can pin it and a run can be replayed.
 */

import { createHash } from 'node:crypto';
import { RECEIPT_MARKER, SUPPRESS_REASON } from '../shared/contracts.js';

/**
 * Canonical JSON: keys sorted at every depth, so two structurally identical
 * bundles hash identically regardless of how they were built. Without this the
 * digest is a function of property insertion order, which makes it useless as
 * an identity — and worse, makes the executor's digest check fail at random.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJSON(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  const keys = Object.keys(value).sort();
  const parts = [];
  for (const k of keys) {
    if (value[k] === undefined) continue; // undefined is absent, not null
    parts.push(`${JSON.stringify(k)}:${canonicalJSON(value[k])}`);
  }
  return `{${parts.join(',')}}`;
}

/** @param {unknown} value */
export function sha256(value) {
  return createHash('sha256').update(typeof value === 'string' ? value : canonicalJSON(value)).digest('hex');
}

/**
 * The digest covers what the agents were shown and nothing else. `digest`
 * itself is excluded, obviously, but so is nothing else — if a field can change
 * what a model concludes, it belongs in the hash.
 *
 * @param {import('../shared/contracts.js').EvidenceBundle} bundle
 */
export function digestBundle(bundle) {
  const { digest: _ignored, ...rest } = bundle;
  return sha256(rest);
}

/**
 * Normalise an alert into a signature: the part that identifies *what kind of
 * thing this is*, with the per-occurrence noise stripped out. Two alerts with
 * the same signature are the same problem reported twice.
 *
 * Numbers, uuids, timestamps, hex blobs and quoted strings all vary between
 * occurrences of one problem, so they are replaced rather than removed — the
 * shape stays, which keeps genuinely different messages apart.
 *
 * @param {{summary: string, component?: string, projectKey: string}} input
 * @returns {string}
 */
export function signatureOf(input) {
  const normalised = (input.summary || '')
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, '<uuid>')
    .replace(/\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?z?\b/g, '<ts>')
    .replace(/\b[0-9a-f]{12,}\b/g, '<hex>')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '<ip>')
    .replace(/"[^"]*"/g, '<str>')
    .replace(/'[^']*'/g, '<str>')
    .replace(/\b\d+(\.\d+)?(ms|s|m|h|%|kb|mb|gb)?\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim();
  return `${input.projectKey}|${input.component || '-'}|${normalised}`;
}

/**
 * @param {import('../shared/contracts.js').MaintenanceWindow[]} windows
 * @param {string} nowISO
 * @param {string} [component]
 * @returns {import('../shared/contracts.js').MaintenanceWindow|null}
 */
export function activeWindow(windows, nowISO, component) {
  const now = Date.parse(nowISO);
  if (Number.isNaN(now)) return null;
  for (const w of windows || []) {
    const from = Date.parse(w.startsAt);
    const to = Date.parse(w.endsAt);
    if (Number.isNaN(from) || Number.isNaN(to)) continue;
    if (now < from || now > to) continue;
    // A window scoped to components only covers those components. A window with
    // no component list covers everything.
    if (Array.isArray(w.components) && w.components.length > 0) {
      if (!component || !w.components.includes(component)) continue;
    }
    return w;
  }
  return null;
}

/**
 * Correlation. Deterministic and fully trusted: it decides what is worth a
 * human's attention at all, before a single token is spent on it.
 *
 * Order matters and is deliberate. Known-benign is checked before duplicate,
 * because "117 copies of a thing we have decided is benign" should be reported
 * as benign, not as a duplicate storm — the reason a human reads needs to be
 * the *useful* one.
 *
 * @param {object} args
 * @param {{issueKey: string, summary: string, component?: string, projectKey: string, priority: string, createdAt: string}} args.incident
 * @param {{issueKey: string, signature: string, createdAt: string}[]} args.recent  other issues in the window
 * @param {import('../shared/contracts.js').RulePack} args.rulePack
 * @param {string} args.now  ISO
 * @returns {import('../shared/contracts.js').CorrelationResult}
 */
export function correlate({ incident, recent, rulePack, now }) {
  const signature = signatureOf(incident);

  const windowMs = Math.max(0, (rulePack.duplicateWindowMinutes ?? 0)) * 60_000;
  const nowMs = Date.parse(now);
  const sameSignature = (recent || []).filter((r) => {
    if (r.signature !== signature) return false;
    if (r.issueKey === incident.issueKey) return false;
    const t = Date.parse(r.createdAt);
    if (Number.isNaN(t) || Number.isNaN(nowMs)) return false;
    return nowMs - t <= windowMs;
  });
  const relatedIssueKeys = sameSignature.map((r) => r.issueKey).sort();
  // The incident itself counts, which is why this is +1. Off-by-one here is the
  // difference between "flapping" and "first occurrence".
  const signatureCount = sameSignature.length + 1;

  const base = { relatedIssueKeys, signatureCount, signature };

  const benign = (rulePack.benignSignatures || []).some((s) => signature.includes(s));
  if (benign) {
    return { ...base, suppress: true, reason: SUPPRESS_REASON.KNOWN_BENIGN };
  }

  const win = activeWindow(rulePack.maintenanceWindows, now, incident.component);
  if (win) {
    return { ...base, suppress: true, reason: SUPPRESS_REASON.MAINTENANCE_WINDOW };
  }

  const flapThreshold = rulePack.flapThreshold ?? 0;
  if (flapThreshold > 0 && signatureCount >= flapThreshold) {
    return { ...base, suppress: true, reason: SUPPRESS_REASON.FLAPPING };
  }

  if (signatureCount > 1) {
    return { ...base, suppress: true, reason: SUPPRESS_REASON.DUPLICATE };
  }

  return { ...base, suppress: false, reason: null };
}

/**
 * Loose match for quote verification: whitespace collapsed, case folded, and
 * the typographic quotes and dashes a model tends to substitute folded onto
 * their ASCII forms.
 *
 * This is deliberately forgiving about *formatting* and completely unforgiving
 * about *content*. A model that reformats a real sentence still passes; a model
 * that invents a sentence does not.
 *
 * @param {string} s
 */
function normaliseForQuoteMatch(s) {
  return String(s)
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Check every quote an agent offered against the evidence — and against SOURCE
 * evidence only.
 *
 * The `source` filter is the whole point. An agent's own output is in the
 * bundle (the reviewer needs to see the diagnosis it is reviewing), so matching
 * quotes against the full bundle would let the reviewer "corroborate" a
 * diagnosis by quoting that diagnosis back. That is not corroboration, so
 * agent-produced items are excluded here.
 *
 * Quotes shorter than MIN_QUOTE_CHARS are not evidence of anything — "error"
 * appears in every log line ever written — so they are reported as unverified
 * rather than counted as a match.
 *
 * @param {string[]} quotes
 * @param {import('../shared/contracts.js').EvidenceBundle} bundle
 * @returns {{verified: boolean, unverified: string[], checked: number}}
 */
export const MIN_QUOTE_CHARS = 12;

export function verifyQuotes(quotes, bundle) {
  const haystack = (bundle.items || [])
    .filter((i) => i.source === true)
    .map((i) => normaliseForQuoteMatch(i.text))
    .join('\n');

  const unverified = [];
  for (const q of quotes || []) {
    const n = normaliseForQuoteMatch(q);
    if (n.length < MIN_QUOTE_CHARS) {
      unverified.push(q);
      continue;
    }
    if (!haystack.includes(n)) unverified.push(q);
  }

  return {
    // No quotes at all is not a failure — an agent is allowed to reason without
    // citing. Fabricating a citation is the failure.
    verified: unverified.length === 0,
    unverified,
    checked: (quotes || []).length,
  };
}

/**
 * Assemble the bundle the agents are allowed to see, and stamp it with its own
 * digest. Pure: give it the same Jira state and you get the same bytes.
 *
 * @param {object} args
 * @param {{issueKey: string, projectKey: string, summary: string, priority: string, status: string, component?: string, description?: string, createdAt: string}} args.incident
 * @param {{author: string, body: string, createdAt: string}[]} [args.comments]
 * @param {{key: string, summary: string, status: string}[]} [args.linkedIssues]
 * @param {import('../shared/contracts.js').CorrelationResult} args.correlation
 * @returns {import('../shared/contracts.js').EvidenceBundle}
 */
export function buildBundle({ incident, comments = [], linkedIssues = [], correlation }) {
  /** @type {import('../shared/contracts.js').EvidenceItem[]} */
  const items = [];

  items.push({
    id: 'field:summary',
    kind: 'field',
    text: incident.summary,
    source: true,
    at: incident.createdAt,
  });
  if (incident.description) {
    items.push({ id: 'field:description', kind: 'field', text: incident.description, source: true, at: incident.createdAt });
  }
  if (incident.component) {
    items.push({ id: 'field:component', kind: 'field', text: incident.component, source: true });
  }

  comments.forEach((c, i) => {
    // Gatekeeper's own receipt comments are not evidence and must not be in the
    // bundle AT ALL — not merely flagged non-source.
    //
    // Found on the first live end-to-end run: triage posts a "held" receipt, the
    // receipt lands as a comment, the bundle digest changes, and when the
    // reviewer's verdict arrives R03 rejects the pending proposal because it
    // "cites" a digest that no longer exists. The app invalidated its own
    // proposal by writing down that it had made one, which made the auto path
    // structurally unreachable.
    //
    // The receipt chain is the canonical history and agents read it with the
    // read-receipts action, so nothing is lost by leaving it out here.
    if (String(c.body || '').startsWith(RECEIPT_MARKER)) return;

    items.push({
      id: `comment:${i}`,
      kind: 'comment',
      text: c.body,
      // A comment Gatekeeper itself wrote is not independent evidence. It is in
      // the bundle so agents can see the history, but it may not be quoted as
      // corroboration — same reasoning as agent output.
      //
      // The discriminator is accountType === 'app', NOT the author's name. The
      // first live run proved why: Jira returns an accountId for app-authored
      // comments, so the name check below never fired, and Gatekeeper's own
      // receipts were being offered to agents as source evidence — defeating
      // the whole point of verifying quotes against source only.
      source: c.authorType !== 'app' && !String(c.author || '').toLowerCase().startsWith('gatekeeper'),
      at: c.createdAt,
    });
  });

  linkedIssues.forEach((l) => {
    items.push({
      id: `linked:${l.key}`,
      kind: 'linked-issue',
      text: `${l.key} (${l.status}): ${l.summary}`,
      source: true,
    });
  });

  items.push({
    id: 'correlation:summary',
    kind: 'correlation',
    text:
      `signature ${correlation.signature} seen ${correlation.signatureCount} time(s) in the window` +
      (correlation.relatedIssueKeys.length ? `; related: ${correlation.relatedIssueKeys.join(', ')}` : ''),
    source: true,
  });

  const bundle = {
    issueKey: incident.issueKey,
    projectKey: incident.projectKey,
    summary: incident.summary,
    priority: incident.priority,
    status: incident.status,
    items,
    correlation,
    digest: '',
  };
  bundle.digest = digestBundle(bundle);
  return bundle;
}
