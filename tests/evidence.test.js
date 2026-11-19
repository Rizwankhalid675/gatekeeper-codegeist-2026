import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MIN_QUOTE_CHARS,
  activeWindow,
  buildBundle,
  canonicalJSON,
  correlate,
  digestBundle,
  signatureOf,
  verifyQuotes,
} from '../src/gate/evidence.js';
import { RECEIPT_MARKER, SUPPRESS_REASON } from '../src/shared/contracts.js';
import { renderReceipt } from '../src/gate/receipts.js';
import { NOW, bundleFor, incident, openPack } from './helpers.js';

test('canonicalJSON is independent of key insertion order', () => {
  const a = { b: 1, a: { d: 2, c: [3, { f: 4, e: 5 }] } };
  const b = { a: { c: [3, { e: 5, f: 4 }], d: 2 }, b: 1 };
  assert.equal(canonicalJSON(a), canonicalJSON(b));
});

test('canonicalJSON treats undefined as absent, not as null', () => {
  assert.equal(canonicalJSON({ a: 1, b: undefined }), canonicalJSON({ a: 1 }));
  assert.notEqual(canonicalJSON({ a: 1, b: null }), canonicalJSON({ a: 1 }));
});

test('the bundle digest covers the evidence and excludes itself', () => {
  const one = bundleFor();
  const two = bundleFor();
  assert.equal(one.digest, two.digest, 'same inputs must give the same digest');

  // Recomputing from the stamped bundle must reproduce the stamp, otherwise the
  // executor's digest check would reject every genuine verdict.
  assert.equal(digestBundle(one), one.digest);

  const changed = bundleFor(incident({ summary: 'something else entirely' }));
  assert.notEqual(changed.digest, one.digest);
});

test('signatureOf strips per-occurrence noise but keeps the shape', () => {
  const a = signatureOf({ projectKey: 'NW', component: 'api', summary: 'timeout after 1500ms from 10.0.0.4' });
  const b = signatureOf({ projectKey: 'NW', component: 'api', summary: 'timeout after 9200ms from 10.0.2.9' });
  assert.equal(a, b, 'two reports of one problem must share a signature');

  const c = signatureOf({ projectKey: 'NW', component: 'api', summary: 'connection refused from 10.0.0.4' });
  assert.notEqual(a, c, 'genuinely different messages must not collide');
});

test('signatureOf separates projects and components', () => {
  const base = { summary: 'disk usage at 91%' };
  assert.notEqual(
    signatureOf({ ...base, projectKey: 'NW', component: 'db' }),
    signatureOf({ ...base, projectKey: 'ACME', component: 'db' }),
  );
  assert.notEqual(
    signatureOf({ ...base, projectKey: 'NW', component: 'db' }),
    signatureOf({ ...base, projectKey: 'NW', component: 'web' }),
  );
});

test('a first occurrence is not suppressed', () => {
  const r = correlate({ incident: incident(), recent: [], rulePack: openPack(), now: NOW });
  assert.equal(r.suppress, false);
  assert.equal(r.reason, null);
  assert.equal(r.signatureCount, 1, 'the incident itself counts once');
});

test('a repeat inside the window is suppressed as a duplicate', () => {
  const inc = incident();
  const sig = signatureOf(inc);
  const r = correlate({
    incident: inc,
    recent: [{ issueKey: 'NW-100', signature: sig, createdAt: '2026-11-19T17:30:00.000Z' }],
    rulePack: openPack({ duplicateWindowMinutes: 60 }),
    now: NOW,
  });
  assert.equal(r.suppress, true);
  assert.equal(r.reason, SUPPRESS_REASON.DUPLICATE);
  assert.deepEqual(r.relatedIssueKeys, ['NW-100']);
  assert.equal(r.signatureCount, 2);
});

test('a repeat outside the window is not a duplicate', () => {
  const inc = incident();
  const sig = signatureOf(inc);
  const r = correlate({
    incident: inc,
    recent: [{ issueKey: 'NW-100', signature: sig, createdAt: '2026-11-19T10:00:00.000Z' }],
    rulePack: openPack({ duplicateWindowMinutes: 60 }),
    now: NOW,
  });
  assert.equal(r.suppress, false);
  assert.equal(r.signatureCount, 1);
});

test('known-benign is reported as benign, not as a duplicate', () => {
  // Ordering matters: a benign signature seen many times should tell the
  // operator "we decided this is benign", which is the useful reason, rather
  // than "this is a duplicate", which is true but unhelpful.
  const inc = incident({ summary: 'health probe recovered after retry in 200ms' });
  const sig = signatureOf(inc);
  const r = correlate({
    incident: inc,
    recent: [
      { issueKey: 'NW-98', signature: sig, createdAt: '2026-11-19T17:50:00.000Z' },
      { issueKey: 'NW-99', signature: sig, createdAt: '2026-11-19T17:55:00.000Z' },
    ],
    rulePack: openPack({ benignSignatures: ['health probe recovered after retry'] }),
    now: NOW,
  });
  assert.equal(r.suppress, true);
  assert.equal(r.reason, SUPPRESS_REASON.KNOWN_BENIGN);
});

test('flapping beats duplicate once the threshold is reached', () => {
  const inc = incident();
  const sig = signatureOf(inc);
  const recent = ['NW-1', 'NW-2', 'NW-3'].map((issueKey, i) => ({
    issueKey,
    signature: sig,
    createdAt: new Date(Date.parse(NOW) - (i + 1) * 60_000).toISOString(),
  }));
  const r = correlate({ incident: inc, recent, rulePack: openPack({ flapThreshold: 4 }), now: NOW });
  assert.equal(r.signatureCount, 4);
  assert.equal(r.reason, SUPPRESS_REASON.FLAPPING);
});

test('every suppression states a reason in writing', () => {
  // The claim "117 of 203 stop here, each states why" has to be structurally
  // true, not just true of the cases someone remembered to check.
  const cases = [
    { pack: { benignSignatures: ['api-gateway returned'] }, recent: [] },
    { pack: { flapThreshold: 2 }, recent: [{ issueKey: 'X', signature: signatureOf(incident()), createdAt: NOW }] },
    { pack: {}, recent: [{ issueKey: 'Y', signature: signatureOf(incident()), createdAt: NOW }] },
    {
      pack: {
        maintenanceWindows: [
          { label: 'patching', startsAt: '2026-11-19T17:00:00.000Z', endsAt: '2026-11-19T19:00:00.000Z' },
        ],
      },
      recent: [],
    },
  ];
  for (const c of cases) {
    const r = correlate({ incident: incident(), recent: c.recent, rulePack: openPack(c.pack), now: NOW });
    assert.equal(r.suppress, true, `expected suppression for ${JSON.stringify(c.pack)}`);
    assert.ok(r.reason, 'a suppressed alert must carry a reason');
    assert.ok(Object.values(SUPPRESS_REASON).includes(r.reason));
  }
});

test('a component-scoped maintenance window only covers that component', () => {
  const windows = [
    {
      label: 'db patching',
      startsAt: '2026-11-19T17:00:00.000Z',
      endsAt: '2026-11-19T19:00:00.000Z',
      components: ['db-primary'],
    },
  ];
  assert.ok(activeWindow(windows, NOW, 'db-primary'));
  assert.equal(activeWindow(windows, NOW, 'api-gateway'), null);
  assert.equal(activeWindow(windows, NOW, undefined), null, 'an unknown component is not covered');
});

test('an unscoped maintenance window covers everything', () => {
  const windows = [{ label: 'all', startsAt: '2026-11-19T17:00:00.000Z', endsAt: '2026-11-19T19:00:00.000Z' }];
  assert.ok(activeWindow(windows, NOW, 'anything'));
  assert.ok(activeWindow(windows, NOW, undefined));
});

test('a window with an unparseable date is skipped rather than throwing', () => {
  const windows = [{ label: 'broken', startsAt: 'not a date', endsAt: 'also not' }];
  assert.equal(activeWindow(windows, NOW, 'api'), null);
});

// --- quote verification: the part that catches a fabricated citation --------

test('a real quote from source evidence verifies', () => {
  const b = bundleFor();
  const r = verifyQuotes(['Upstream pool exhausted. Retries did not recover the probe.'], b);
  assert.equal(r.verified, true, r.unverified.join(' | '));
});

test('a fabricated quote does not verify', () => {
  const b = bundleFor();
  const r = verifyQuotes(['The on-call engineer confirmed this was a planned change.'], b);
  assert.equal(r.verified, false);
  assert.equal(r.unverified.length, 1);
});

test('reformatting is forgiven; inventing is not', () => {
  const b = bundleFor();
  const reformatted = verifyQuotes(['upstream   pool    EXHAUSTED.'], b);
  assert.equal(reformatted.verified, true, 'whitespace and case must not matter');

  const typographic = verifyQuotes(['Retries did not recover the probe.'.replace(/'/g, '’')], b);
  assert.equal(typographic.verified, true, 'smart quotes must fold onto ASCII');
});

test('an agent cannot corroborate itself: non-source items are excluded', () => {
  // This is the single most important line in the file. The reviewer sees the
  // diagnosis it is reviewing, so if quotes matched the whole bundle, quoting
  // the diagnosis back would count as corroboration. It must not.
  const b = bundleFor();
  const fabricatedByDiagnosis = 'Root cause is a leaking connection pool in the gateway.';
  b.items.push({ id: 'agent:diagnosis', kind: 'agent', text: fabricatedByDiagnosis, source: false });

  const r = verifyQuotes([fabricatedByDiagnosis], b);
  assert.equal(r.verified, false, "another agent's output is not corroboration");
});

test("Gatekeeper's own comments are not independent evidence", () => {
  const b = bundleFor(incident(), {
    comments: [
      { author: 'gatekeeper:executor', body: 'Gatekeeper held this action pending review.', createdAt: NOW },
      { author: 'alice', body: 'I restarted the gateway pool manually at 17:40.', createdAt: NOW },
    ],
  });

  assert.equal(verifyQuotes(['Gatekeeper held this action pending review.'], b).verified, false);
  assert.equal(verifyQuotes(['I restarted the gateway pool manually at 17:40.'], b).verified, true);
});

test("an app-authored comment is not source evidence, even though its author is an accountId", () => {
  // The shape Jira actually returns for a comment Gatekeeper posted, observed on
  // the first live run: author is an accountId and the display name is "Gatekeeper".
  // The old check tested whether the author STRING started with "gatekeeper",
  // which an accountId never does — so our own receipts were being handed to
  // agents as corroborating source evidence.
  const receipt = '*Gatekeeper - held* Held by R04, R07: unattended action is switched off for CLSD';
  const b = bundleFor(incident(), {
    comments: [
      { author: '712020:9f1c0a44-0000-4aaa-bbbb-ccccccccdddd', authorType: 'app', body: receipt, createdAt: NOW },
      { author: '557058:1111-2222', authorType: 'atlassian', body: 'I checked the sanctions list myself.', createdAt: NOW },
    ],
  });

  assert.equal(verifyQuotes([receipt], b).verified, false, "Gatekeeper's own receipt must not corroborate anything");
  assert.equal(verifyQuotes(['I checked the sanctions list myself.'], b).verified, true, 'a human comment is source evidence');
});

test('a comment with no accountType is still treated as a human comment', () => {
  // Defensive: if Jira omits accountType, the safe default is to treat it as a
  // person, because the alternative silently drops real evidence.
  const b = bundleFor(incident(), {
    comments: [{ author: '557058:abc', body: 'The upstream pool was restarted at 17:40.', createdAt: NOW }],
  });
  assert.equal(verifyQuotes(['The upstream pool was restarted at 17:40.'], b).verified, true);
});

test('a quote too short to identify anything is not treated as verified', () => {
  const b = bundleFor();
  const short = 'x'.repeat(MIN_QUOTE_CHARS - 1);
  const r = verifyQuotes([short], b);
  assert.equal(r.verified, false, 'a fragment is not a citation');
});

test('no quotes at all is not a failure', () => {
  const b = bundleFor();
  const r = verifyQuotes([], b);
  assert.equal(r.verified, true);
  assert.equal(r.checked, 0);
});

test("Gatekeeper's own receipt comment does not change the evidence digest", () => {
  // The bug that made the auto path structurally unreachable, found on the first
  // live end-to-end run. Triage posts a "held" receipt; the receipt is a comment;
  // the comment changed the bundle; the digest moved; and when the reviewer's
  // verdict arrived, R03 rejected the pending proposal for citing a digest that
  // no longer existed. The app invalidated its own proposal by recording it.
  const before = bundleFor(incident(), {
    comments: [{ author: '557058:abc', authorType: 'atlassian', body: 'A human said something.', createdAt: NOW }],
  });

  // Exactly what renderReceipt writes, via the shared marker.
  const receiptComment = `${RECEIPT_MARKER}held*\n\nHeld by R04, R07: unattended action is switched off for CLSD`;
  const after = bundleFor(incident(), {
    comments: [
      { author: '557058:abc', authorType: 'atlassian', body: 'A human said something.', createdAt: NOW },
      { author: '712020:app-account-id', authorType: 'app', body: receiptComment, createdAt: NOW },
    ],
  });

  assert.equal(after.digest, before.digest, 'posting a receipt must not invalidate a pending proposal');
  assert.ok(
    !after.items.some((i) => i.text.includes('Held by R04')),
    'the receipt must not appear in the evidence bundle at all',
  );
});

test('the receipt marker the renderer writes is the one the bundle filters on', () => {
  // Two places have to agree exactly. If they drift, the digest starts moving
  // again on every receipt and the auto path silently breaks a second time.
  const rendered = renderReceipt(
    {
      seq: '000000',
      issueKey: 'NW-1',
      actor: 'gatekeeper:executor',
      event: 'held',
      evidenceDigest: 'a'.repeat(64),
      rulePackVersion: 1,
      action: null,
      reason: 'because',
      at: NOW,
      prev: 'GENESIS',
      digest: 'd'.repeat(64),
    },
    { outcomes: [] },
  );
  assert.ok(rendered.startsWith(RECEIPT_MARKER), `renderReceipt output must start with the marker, got: ${rendered.slice(0, 30)}`);
});

test('the bundle marks source and non-source items correctly', () => {
  const b = buildBundle({
    incident: incident(),
    comments: [{ author: 'bob', body: 'seen before', createdAt: NOW }],
    linkedIssues: [{ key: 'NW-9', summary: 'earlier outage', status: 'Done' }],
    correlation: { suppress: false, reason: null, relatedIssueKeys: [], signatureCount: 1, signature: 'sig' },
  });
  for (const item of b.items) {
    assert.equal(typeof item.source, 'boolean', `${item.id} must declare whether it is source evidence`);
  }
  assert.ok(b.items.some((i) => i.kind === 'linked-issue' && i.source === true));
});
