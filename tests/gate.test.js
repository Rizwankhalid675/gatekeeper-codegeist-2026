import test from 'node:test';
import assert from 'node:assert/strict';

import { RULE_IDS, decide } from '../src/gate/gate.js';
import { DISPOSITION, parseAgentProposal } from '../src/shared/contracts.js';
import { NOW, bundleFor, incident, openPack, proposalFor, reviewConfirm } from './helpers.js';

const fired = (v, rule) => v.outcomes.find((o) => o.rule === rule)?.fired === true;
const ruleOf = (v, rule) => v.outcomes.find((o) => o.rule === rule);

test('every verdict reports all eleven rules, fired or not', () => {
  const bundle = bundleFor();
  const v = decide({ proposal: proposalFor(bundle), review: reviewConfirm(), bundle, rulePack: openPack(), now: NOW });

  assert.equal(v.outcomes.length, 11);
  assert.deepEqual(v.outcomes.map((o) => o.rule), RULE_IDS);
  for (const o of v.outcomes) {
    assert.ok(o.title, `${o.rule} must have a title`);
    assert.ok(o.detail, `${o.rule} must explain itself, fired or not`);
  }
});

test('the happy path reaches auto', () => {
  const bundle = bundleFor();
  const v = decide({ proposal: proposalFor(bundle), review: reviewConfirm(), bundle, rulePack: openPack(), now: NOW });
  assert.equal(v.disposition, DISPOSITION.AUTO, v.reason);
  assert.equal(v.outcomes.filter((o) => o.fired).length, 0);
});

test('the verdict carries the rule pack version and evidence digest', () => {
  const bundle = bundleFor();
  const pack = openPack({ version: 42 });
  const v = decide({ proposal: proposalFor(bundle), review: reviewConfirm(), bundle, rulePack: pack, now: NOW });
  assert.equal(v.rulePackVersion, 42);
  assert.equal(v.evidenceDigest, bundle.digest);
});

test('decide is deterministic: identical inputs give an identical verdict', () => {
  const bundle = bundleFor();
  const args = { proposal: proposalFor(bundle), review: reviewConfirm(), bundle, rulePack: openPack(), now: NOW };
  assert.deepEqual(decide(args), decide(args));
});

// --- R01-R03: reject --------------------------------------------------------

test('R01 rejects an action the agent invented', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle, { action: { id: 'delete-production-database', params: {} } }),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.REJECT);
  assert.ok(fired(v, 'R01'));
  assert.match(v.reason, /invented/);
});

test('R02 rejects a permitted action carrying a value that is not permitted', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle, { action: { id: 'label-incident', params: { label: 'wontfix' } } }),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.REJECT);
  assert.ok(fired(v, 'R02'));
});

test('R02 passes a value that is on the allow-list', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle, { action: { id: 'label-incident', params: { label: 'gatekeeper-incident' } } }),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.AUTO, v.reason);
});

test('R03 rejects a proposal about a different view of the issue', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle, { evidenceDigest: 'f'.repeat(64) }),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.REJECT);
  assert.ok(fired(v, 'R03'));
});

test('a reject wins over a hold', () => {
  // Both conditions are present. The more conservative outcome must win, and
  // the reason must name the rejecting rule rather than the holding one.
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle, { action: { id: 'not-a-real-action', params: {} }, confidence: 0.1 }),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.REJECT);
  assert.ok(fired(v, 'R01'));
  assert.ok(fired(v, 'R06'));
  assert.match(v.reason, /^Refused by R01/);
});

// --- R04-R11: hold ----------------------------------------------------------

test('R04 holds everything when the project has not opted into unattended action', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack({ unattendedAllowed: false }),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.HOLD);
  assert.ok(fired(v, 'R04'));
});

test('R05 holds an action the rule pack caps at hold, however confident the model is', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle, {
      action: { id: 'transition-issue', params: { to: 'Resolved' } },
      confidence: 1,
    }),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.HOLD);
  assert.ok(fired(v, 'R05'));
});

test('R06 holds below the confidence floor and passes at exactly the floor', () => {
  const bundle = bundleFor();
  const pack = openPack({ confidenceFloor: 0.75 });

  const below = decide({ proposal: proposalFor(bundle, { confidence: 0.74 }), review: reviewConfirm(), bundle, rulePack: pack, now: NOW });
  assert.equal(below.disposition, DISPOSITION.HOLD);
  assert.ok(fired(below, 'R06'));

  // The floor is "at or above", so the boundary itself must pass. Off-by-one
  // here silently halves the automation rate.
  const at = decide({ proposal: proposalFor(bundle, { confidence: 0.75 }), review: reviewConfirm(), bundle, rulePack: pack, now: NOW });
  assert.equal(at.disposition, DISPOSITION.AUTO, at.reason);
});

test('R07 holds an unreviewed proposal: nothing runs without an adversarial review', () => {
  const bundle = bundleFor();
  const v = decide({ proposal: proposalFor(bundle), review: null, bundle, rulePack: openPack(), now: NOW });
  assert.equal(v.disposition, DISPOSITION.HOLD, 'a proposal nothing reviewed must not auto-execute');
  assert.ok(fired(v, 'R07'));
  assert.match(ruleOf(v, 'R07').detail, /no adversarial review/);
});

test('R07 holds on reviewer dissent', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle),
    review: reviewConfirm({ verdict: 'dissent', rationale: 'The pool was already restarted.' }),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.HOLD);
  assert.ok(fired(v, 'R07'));
});

test('R08 holds when the reviewer cites a quote that is not in the evidence', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle),
    review: reviewConfirm({ quotes: ['The change was approved by the on-call engineer at 17:45.'] }),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.HOLD);
  assert.ok(fired(v, 'R08'));
  assert.match(ruleOf(v, 'R08').detail, /not in the source evidence/);
});

test('R08 recomputes the citation check and ignores the flag it was handed', () => {
  // The decisive test. `quotesVerified: true` is a field a model could fill in,
  // or a caller could get wrong. The gate must verify the quotes itself, so a
  // true flag over a fabricated quote changes nothing.
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle),
    review: reviewConfirm({
      quotes: ['A second engineer independently confirmed the diagnosis.'],
      quotesVerified: true,
      unverifiedQuotes: [],
    }),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.HOLD, 'a claimed verification must not be trusted');
  assert.ok(fired(v, 'R08'));
});

test('R08 passes a reviewer that cites the evidence honestly', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle),
    review: reviewConfirm({ quotes: ['Upstream pool exhausted. Retries did not recover the probe.'] }),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.AUTO, v.reason);
  assert.match(ruleOf(v, 'R08').detail, /verified against source evidence/);
});

test('R09 holds a priority the project reserves for humans', () => {
  const bundle = bundleFor(incident({ priority: 'Highest' }));
  const v = decide({
    proposal: proposalFor(bundle),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack({ requireHumanPriorities: ['Highest'] }),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.HOLD);
  assert.ok(fired(v, 'R09'));
});

test('R10 holds an irreversible action even when everything else passes', () => {
  const bundle = bundleFor();
  const pack = openPack();
  pack.actions = pack.actions.map((a) =>
    a.id === 'comment-triage-summary' ? { ...a, reversible: false } : a,
  );
  const v = decide({ proposal: proposalFor(bundle), review: reviewConfirm(), bundle, rulePack: pack, now: NOW });
  assert.equal(v.disposition, DISPOSITION.HOLD);
  assert.ok(fired(v, 'R10'));
});

test('R11 holds an incident inside a maintenance window', () => {
  const pack = openPack({
    maintenanceWindows: [
      { label: 'patching', startsAt: '2026-11-19T17:00:00.000Z', endsAt: '2026-11-19T19:00:00.000Z' },
    ],
  });
  const bundle = bundleFor(incident(), { rulePack: pack });
  const v = decide({ proposal: proposalFor(bundle), review: reviewConfirm(), bundle, rulePack: pack, now: NOW });
  assert.equal(v.disposition, DISPOSITION.HOLD);
  assert.ok(fired(v, 'R11'));
});

// --- degenerate inputs ------------------------------------------------------

test('no proposal holds rather than auto-executing or crashing', () => {
  const bundle = bundleFor();
  const v = decide({ proposal: null, review: null, bundle, rulePack: openPack(), now: NOW });
  assert.equal(v.disposition, DISPOSITION.HOLD);
  assert.equal(v.action, null);
  assert.equal(v.outcomes.length, 11, 'all eleven rules are still reported');
});

test('a diagnosis with no action holds', () => {
  const bundle = bundleFor();
  const v = decide({
    proposal: proposalFor(bundle, { agent: 'diagnosis', action: null }),
    review: reviewConfirm(),
    bundle,
    rulePack: openPack(),
    now: NOW,
  });
  assert.equal(v.disposition, DISPOSITION.HOLD);
  assert.match(v.reason, /only a diagnosis/);
});

test('the gate can never make the outcome less conservative than asked', () => {
  // Sweep the levers. Whatever combination arrives, the result is one of the
  // three dispositions and auto requires an action — there is no input that
  // produces "auto, nothing to do", which would log a success for a no-op.
  const bundle = bundleFor();
  for (const unattended of [true, false]) {
    for (const confidence of [0, 0.5, 0.75, 1]) {
      for (const verdict of ['confirm', 'dissent']) {
        for (const actionId of ['comment-triage-summary', 'transition-issue', null]) {
          const v = decide({
            proposal: proposalFor(bundle, {
              confidence,
              action: actionId ? { id: actionId, params: actionId === 'transition-issue' ? { to: 'Triage' } : { body: 'x' } } : null,
            }),
            review: reviewConfirm({ verdict }),
            bundle,
            rulePack: openPack({ unattendedAllowed: unattended }),
            now: NOW,
          });
          assert.ok(Object.values(DISPOSITION).includes(v.disposition));
          if (v.disposition === DISPOSITION.AUTO) {
            assert.ok(v.action, 'auto must always carry an action');
            assert.equal(unattended, true);
            assert.equal(verdict, 'confirm');
            assert.ok(confidence >= 0.75);
          }
        }
      }
    }
  }
});

// --- the validator in front of the gate -------------------------------------

test('malformed model output is refused before it reaches the gate', () => {
  for (const bad of [
    null,
    'a string',
    { agent: 'triage' },
    { agent: 'nope', rationale: 'x', confidence: 0.9, quotes: [] },
    { agent: 'triage', rationale: '', confidence: 0.9, quotes: [] },
    { agent: 'triage', rationale: 'x', confidence: 'high', quotes: [] },
    { agent: 'triage', rationale: 'x', confidence: 1.5, quotes: [] },
    { agent: 'triage', rationale: 'x', confidence: -0.1, quotes: [] },
    { agent: 'triage', rationale: 'x', confidence: Number.NaN, quotes: [] },
    { agent: 'triage', rationale: 'x', confidence: 0.9, quotes: 'not an array' },
    { agent: 'triage', rationale: 'x', confidence: 0.9, quotes: [1, 2] },
    { agent: 'triage', rationale: 'x', confidence: 0.9, quotes: [], action: { params: {} } },
  ]) {
    const r = parseAgentProposal(bad);
    assert.equal(r.ok, false, `should have refused: ${JSON.stringify(bad)}`);
  }
});

test('an out-of-range confidence is refused, not clipped', () => {
  // Clipping 1.5 to 1.0 would turn a malformed response into the most
  // confident possible one, which is the worst available failure mode.
  const r = parseAgentProposal({ agent: 'triage', rationale: 'x', confidence: 1.5, quotes: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /out of range/);
});

test('a well-formed proposal parses and keeps its values', () => {
  const r = parseAgentProposal({
    agent: 'remediation',
    issueKey: 'NW-1',
    evidenceDigest: 'abc',
    rationale: 'because',
    confidence: 0.81,
    quotes: ['one'],
    action: { id: 'label-incident', params: { label: 'gatekeeper-incident' } },
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.confidence, 0.81);
  assert.equal(r.value.action.id, 'label-incident');
});
