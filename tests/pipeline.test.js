/**
 * pipeline.test.js — the whole flow, with Jira faked at the seam.
 *
 * This is the test that would have caught the two-agent handoff being wired
 * wrong. The gate's own tests prove the rules; these prove that the rules are
 * actually reached, in the right order, with the right things stored in between.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { DISPOSITION, KEY, RECEIPT_EVENT } from '../src/shared/contracts.js';
import { signatureOf } from '../src/gate/evidence.js';
import { readChain, verifyChain } from '../src/gate/receipts.js';
import { saveRulePack } from '../src/gate/rulepack.js';
import {
  parseParams,
  parseQuotes,
  runDescribeRulePack,
  runExplain,
  runReadReceipts,
  runReview,
  runTriage,
} from '../src/agent/pipeline.js';
import { NOW, incident, memStore, openPack, spyEffects } from './helpers.js';

const SOURCE_LINE = 'Upstream pool exhausted. Retries did not recover the probe.';

/**
 * @param {object} over
 */
function fakeDeps(over = {}) {
  const store = over.store ?? memStore();
  const effects = over.effects ?? spyEffects();
  const inc = over.incident ?? incident();
  const recent = over.recent ?? [];

  return {
    store,
    effects,
    now: () => over.now ?? NOW,
    log: () => {},
    jira: {
      async fetchIncident() {
        return inc;
      },
      async fetchComments() {
        return over.comments ?? [];
      },
      async fetchLinkedIssues() {
        return over.linkedIssues ?? [];
      },
      async fetchRecentIssues() {
        return recent;
      },
    },
    _incident: inc,
  };
}

const goodProposal = {
  issueKey: 'NW-101',
  rationale: 'Upstream pool exhaustion matches the runbook; summarise it on the issue.',
  confidence: 0.88,
  actionId: 'comment-triage-summary',
  params: JSON.stringify({ body: 'Triage: upstream pool exhausted.' }),
  quotes: SOURCE_LINE,
};

async function withOpenPack(deps) {
  await saveRulePack(deps.store, openPack({ version: 1 }));
  return deps;
}

// --- input parsing at the trust boundary ------------------------------------

test('params must be a JSON object, and malformed JSON is refused not defaulted', () => {
  assert.deepEqual(parseParams(undefined), { ok: true, value: {} });
  assert.deepEqual(parseParams(''), { ok: true, value: {} });
  assert.deepEqual(parseParams('{"body":"x"}'), { ok: true, value: { body: 'x' } });

  // Defaulting these to {} would turn "comment with this body" into "comment
  // with no body", and the operator would be told the wrong reason for failure.
  assert.equal(parseParams('{body: x}').ok, false);
  assert.equal(parseParams('["a"]').ok, false);
  assert.equal(parseParams('"a string"').ok, false);
  assert.equal(parseParams('null').ok, false);
});

test('quotes split on newlines and drop blanks', () => {
  assert.deepEqual(parseQuotes('one\n\n  two  \n'), ['one', 'two']);
  assert.deepEqual(parseQuotes(''), []);
  assert.deepEqual(parseQuotes(undefined), []);
});

// --- correlation short-circuits before any model is consulted ---------------

test('a duplicate is suppressed without any agent being asked', async () => {
  const inc = incident();
  const deps = await withOpenPack(
    fakeDeps({
      incident: inc,
      recent: [{ issueKey: 'NW-100', projectKey: 'NW', summary: inc.summary, component: inc.component, createdAt: '2026-11-19T17:40:00.000Z' }],
    }),
  );

  const result = await runTriage(deps, { issueKey: 'NW-101', ...goodProposal });

  assert.equal(result.ok, true);
  assert.equal(result.outcome, 'suppressed');
  assert.match(result.reason, /duplicate/);
  assert.deepEqual(result.relatedIssues, ['NW-100']);

  const chain = await readChain(deps.store, 'NW-101');
  assert.equal(chain.length, 1);
  assert.equal(chain[0].event, RECEIPT_EVENT.SUPPRESSED);
  assert.equal(chain[0].actor, 'gatekeeper:correlation');

  // No proposal is stored, because none was considered.
  assert.equal(await deps.store.get(KEY.run('NW-101')), undefined);
});

test('a suppressed alert still states its reason in writing', async () => {
  const inc = incident({ summary: 'scheduled backup verification completed in 900ms' });
  const deps = await withOpenPack(fakeDeps({ incident: inc }));
  await saveRulePack(deps.store, openPack({ version: 2, benignSignatures: ['scheduled backup verification'] }));

  const result = await runTriage(deps, { issueKey: 'NW-101', ...goodProposal });
  assert.equal(result.outcome, 'suppressed');
  assert.match(result.reason, /known-benign/);
});

// --- the two-agent handoff --------------------------------------------------

test('triage alone is held: nothing runs without an adversarial review', async () => {
  const deps = await withOpenPack(fakeDeps());

  const result = await runTriage(deps, goodProposal);

  assert.equal(result.ok, true);
  assert.equal(result.outcome, DISPOSITION.HOLD);
  assert.equal(result.executed, false);
  assert.ok(
    result.rulesFired.some((r) => r.startsWith('R07')),
    `expected R07 to fire, got ${JSON.stringify(result.rulesFired)}`,
  );
  assert.match(result.nextStep, /adversarial review/);

  // The receipt comment is written, but the proposed comment action is not
  // executed. One effect call, and it is the receipt.
  assert.equal(deps.effects.calls.length, 1);
  assert.match(deps.effects.calls[0].args[1], /Gatekeeper · held/);

  const run = await deps.store.get(KEY.run('NW-101'));
  assert.ok(run.proposal, 'the proposal is preserved for the reviewer');
  assert.equal(run.review, null);
});

test('a confirming review with a real citation reaches auto and executes', async () => {
  const deps = await withOpenPack(fakeDeps());
  await runTriage(deps, goodProposal);
  deps.effects.calls.length = 0;

  const result = await runReview(deps, {
    issueKey: 'NW-101',
    verdict: 'confirm',
    rationale: 'The evidence says the pool was exhausted and nobody has acted yet.',
    quotes: SOURCE_LINE,
  });

  assert.equal(result.outcome, DISPOSITION.AUTO, result.reason);
  assert.equal(result.executed, true);
  assert.match(result.citationCheck, /verified against source evidence/);

  // Two effects now: the proposed comment, then the receipt comment.
  assert.equal(deps.effects.calls.length, 2);
  assert.equal(deps.effects.calls[0].args[1], 'Triage: upstream pool exhausted.');
  assert.match(deps.effects.calls[1].args[1], /Gatekeeper · executed/);

  const chain = await readChain(deps.store, 'NW-101');
  assert.deepEqual(chain.map((r) => r.event), [RECEIPT_EVENT.HELD, RECEIPT_EVENT.EXECUTED]);
  assert.equal(verifyChain(chain).ok, true);
});

test('a confirming review with a FABRICATED citation is held, not executed', async () => {
  // The headline behaviour. The reviewer says confirm and offers a quote to
  // justify it; the quote is not in the evidence; the action is held.
  const deps = await withOpenPack(fakeDeps());
  await runTriage(deps, goodProposal);
  deps.effects.calls.length = 0;

  const result = await runReview(deps, {
    issueKey: 'NW-101',
    verdict: 'confirm',
    rationale: 'A second engineer already signed this off.',
    quotes: 'The on-call engineer confirmed the pool was restarted at 17:45.',
  });

  assert.equal(result.outcome, DISPOSITION.HOLD);
  assert.equal(result.executed, false);
  assert.ok(result.rulesFired.some((r) => r.startsWith('R08')));
  assert.match(result.citationCheck, /not in the source evidence/);

  // The proposed action never ran. Only the receipt comment was written.
  assert.equal(deps.effects.calls.length, 1);
  assert.match(deps.effects.calls[0].args[1], /Gatekeeper · held/);
});

test('a reviewer cannot clear R08 by asserting its own quotes are verified', async () => {
  // runReview stores quotesVerified: false and the gate recomputes. There is no
  // input through which a model can claim verification.
  const deps = await withOpenPack(fakeDeps());
  await runTriage(deps, goodProposal);

  const result = await runReview(deps, {
    issueKey: 'NW-101',
    verdict: 'confirm',
    rationale: 'Verified.',
    quotes: 'I have checked this against the logs and it is correct.',
    quotesVerified: true,
    unverifiedQuotes: '',
  });

  assert.equal(result.outcome, DISPOSITION.HOLD);
  const run = await deps.store.get(KEY.run('NW-101'));
  assert.equal(run.review.quotesVerified, false, 'the stored review must never claim verification');
});

test('a dissenting review holds even with honest citations', async () => {
  const deps = await withOpenPack(fakeDeps());
  await runTriage(deps, goodProposal);

  const result = await runReview(deps, {
    issueKey: 'NW-101',
    verdict: 'dissent',
    rationale: 'This looks like a symptom of the upstream deploy, not the cause.',
    quotes: SOURCE_LINE,
  });

  assert.equal(result.outcome, DISPOSITION.HOLD);
  assert.ok(result.rulesFired.some((r) => r.startsWith('R07')));
});

test('a review with no proposal on the record is refused and explains why', async () => {
  const deps = await withOpenPack(fakeDeps());
  const result = await runReview(deps, { issueKey: 'NW-101', verdict: 'confirm', rationale: 'fine' });
  assert.equal(result.ok, false);
  assert.match(result.error, /no proposal on the record/);
});

test('a verdict word other than confirm or dissent is refused', async () => {
  const deps = await withOpenPack(fakeDeps());
  await runTriage(deps, goodProposal);
  for (const verdict of ['looks good', 'CONFIRMED', 'yes', '']) {
    const r = await runReview(deps, { issueKey: 'NW-101', verdict, rationale: 'x' });
    assert.equal(r.ok, false, `should have refused "${verdict}"`);
  }
  // The two valid spellings, case-insensitively, are accepted.
  assert.equal((await runReview(deps, { issueKey: 'NW-101', verdict: 'Confirm', rationale: 'x' })).ok, true);
});

// --- malformed model output -------------------------------------------------

test('an out-of-range confidence is refused before the gate and nothing is stored', async () => {
  const deps = await withOpenPack(fakeDeps());
  const result = await runTriage(deps, { ...goodProposal, confidence: 1.4 });

  assert.equal(result.ok, false);
  assert.match(result.error, /before it reached the policy gate/);
  assert.equal(await deps.store.get(KEY.run('NW-101')), undefined);
  assert.deepEqual(await readChain(deps.store, 'NW-101'), [], 'a refused proposal writes no receipt');
  assert.equal(deps.effects.calls.length, 0);
});

test('malformed params are refused with the real reason', async () => {
  const deps = await withOpenPack(fakeDeps());
  const result = await runTriage(deps, { ...goodProposal, params: '{body: missing quotes}' });
  assert.equal(result.ok, false);
  assert.match(result.error, /not valid JSON/);
});

test('an invented action id is rejected by the gate, with a receipt', async () => {
  const deps = await withOpenPack(fakeDeps());
  const result = await runTriage(deps, { ...goodProposal, actionId: 'restart-the-datacentre' });

  assert.equal(result.outcome, DISPOSITION.REJECT);
  assert.ok(result.rulesFired.some((r) => r.startsWith('R01')));

  const chain = await readChain(deps.store, 'NW-101');
  assert.equal(chain[0].event, RECEIPT_EVENT.REJECTED);
});

test('a missing issueKey is refused everywhere', async () => {
  const deps = await withOpenPack(fakeDeps());
  for (const fn of [runTriage, runReview, runExplain, runReadReceipts]) {
    const r = await fn(deps, {});
    assert.equal(r.ok, false, `${fn.name} should require an issueKey`);
  }
});

// --- read-only actions ------------------------------------------------------

test('explain-verdict reports all eleven rules, passed and fired', async () => {
  const deps = await withOpenPack(fakeDeps());
  await runTriage(deps, goodProposal);

  const result = await runExplain(deps, { issueKey: 'NW-101' });
  assert.equal(result.rules.length, 11);
  assert.ok(result.rules.some((r) => r.fired));
  assert.ok(result.rules.some((r) => !r.fired));
  for (const r of result.rules) assert.ok(r.detail, `${r.rule} must explain itself`);
});

test('explain-verdict on an untouched issue says so rather than inventing a verdict', async () => {
  const deps = await withOpenPack(fakeDeps());
  const result = await runExplain(deps, { issueKey: 'NW-999' });
  assert.equal(result.outcome, 'none');
  assert.match(result.reason, /has not decided anything/);
});

test('read-receipts reports whether the chain verifies rather than asserting it does', async () => {
  const deps = await withOpenPack(fakeDeps());
  await runTriage(deps, goodProposal);

  const clean = await runReadReceipts(deps, { issueKey: 'NW-101' });
  assert.equal(clean.chainVerified, true);
  assert.equal(clean.length, 1);

  // Tamper with stored history, then ask again.
  const tampered = await deps.store.get(KEY.receipt('NW-101', '000000'));
  await deps.store.set(KEY.receipt('NW-101', '000000'), { ...tampered, reason: 'approved by a human' });

  const dirty = await runReadReceipts(deps, { issueKey: 'NW-101' });
  assert.equal(dirty.chainVerified, false);
  assert.match(dirty.chainProblem, /digest mismatch/);
});

test('describe-rulepack tells the truth about a project nobody has configured', async () => {
  // The default must be conservative, and must say so in words a user reads.
  const deps = fakeDeps();
  const result = await runDescribeRulePack(deps, { projectKey: 'FRESH' });

  assert.equal(result.unattendedAllowed, false);
  assert.match(result.note, /switched OFF/);
  for (const a of result.actions) assert.equal(a.canRunUnattended, false);
});

test('describe-rulepack reflects an opted-in project', async () => {
  const deps = await withOpenPack(fakeDeps());
  const result = await runDescribeRulePack(deps, { projectKey: 'NW' });

  assert.equal(result.unattendedAllowed, true);
  assert.ok(result.actions.some((a) => a.canRunUnattended), 'some action should be runnable');
  assert.ok(
    result.actions.some((a) => a.id === 'transition-issue' && a.canRunUnattended === false),
    'an action capped at hold must report that it cannot run unattended',
  );
});

// --- multi-tenancy: same incident, two packs, different outcomes ------------

test('the same incident is decided differently by two rule packs', async () => {
  // The multi-tenancy claim, as a test rather than an assertion in a README.
  const shared = { incident: incident(), recent: [] };

  const open = await withOpenPack(fakeDeps({ ...shared }));
  await runTriage(open, goodProposal);
  const openResult = await runReview(open, {
    issueKey: 'NW-101',
    verdict: 'confirm',
    rationale: 'ok',
    quotes: SOURCE_LINE,
  });

  const strict = fakeDeps({ ...shared });
  await saveRulePack(strict.store, openPack({ version: 1, unattendedAllowed: false }));
  await runTriage(strict, goodProposal);
  const strictResult = await runReview(strict, {
    issueKey: 'NW-101',
    verdict: 'confirm',
    rationale: 'ok',
    quotes: SOURCE_LINE,
  });

  assert.equal(openResult.outcome, DISPOSITION.AUTO);
  assert.equal(strictResult.outcome, DISPOSITION.HOLD);
  assert.equal(strict.effects.calls.filter((c) => c.args[1] === 'Triage: upstream pool exhausted.').length, 0);
});

test('a project with a higher confidence floor holds what a lower one allows', async () => {
  const shared = { incident: incident(), recent: [] };

  const strict = fakeDeps({ ...shared });
  await saveRulePack(strict.store, openPack({ version: 1, confidenceFloor: 0.95 }));
  await runTriage(strict, goodProposal); // confidence 0.88
  const result = await runReview(strict, {
    issueKey: 'NW-101',
    verdict: 'confirm',
    rationale: 'ok',
    quotes: SOURCE_LINE,
  });

  assert.equal(result.outcome, DISPOSITION.HOLD);
  assert.ok(result.rulesFired.some((r) => r.startsWith('R06')));
});

// --- the receipt comment must not change the decision ----------------------

test('a failure writing the receipt comment does not change what was decided', async () => {
  // Jira being unavailable for a comment must not turn an executed action into
  // an unrecorded one, nor a hold into a failure.
  const effects = spyEffects();
  const original = effects.comment;
  // Discriminate by content, not by call order: fail only the receipt comment
  // and let the proposed action through.
  effects.comment = async (issueKey, body) => {
    if (String(body).startsWith('*Gatekeeper ·')) throw new Error('Jira is down');
    return original(issueKey, body);
  };

  const deps = await withOpenPack(fakeDeps({ effects }));
  await runTriage(deps, goodProposal);
  const result = await runReview(deps, {
    issueKey: 'NW-101',
    verdict: 'confirm',
    rationale: 'ok',
    quotes: SOURCE_LINE,
  });

  assert.equal(result.ok, true, 'the pipeline must not fail because a comment failed');
  assert.equal(result.executed, true, 'the action itself still ran');
  const chain = await readChain(deps.store, 'NW-101');
  assert.deepEqual(chain.map((r) => r.event), [RECEIPT_EVENT.HELD, RECEIPT_EVENT.EXECUTED]);
  assert.equal(verifyChain(chain).ok, true, 'the receipt is in storage regardless of the comment');
});

test('an authorised action that FAILS is still recorded', async () => {
  // Found by the test above failing for the wrong reason: when the effect threw,
  // execute() propagated and wrote no receipt at all, so an action that was
  // authorised and attempted left no trace. The claim is "nothing is attempted
  // without a receipt", so a failed attempt has to be recorded too.
  const effects = spyEffects();
  effects.comment = async () => {
    throw new Error('Jira rejected the request: field is read-only');
  };

  const deps = await withOpenPack(fakeDeps({ effects }));
  await runTriage(deps, goodProposal);
  const result = await runReview(deps, {
    issueKey: 'NW-101',
    verdict: 'confirm',
    rationale: 'ok',
    quotes: SOURCE_LINE,
  });

  // The agent is told it failed, with the real reason.
  assert.equal(result.ok, false);
  assert.match(result.error, /read-only/);

  const chain = await readChain(deps.store, 'NW-101');
  const failed = chain.find((r) => r.event === RECEIPT_EVENT.FAILED);
  assert.ok(failed, 'a failed attempt must appear in the chain');
  assert.match(failed.reason, /Authorised by the gate, but the action failed/);
  assert.equal(failed.action.id, 'comment-triage-summary');
  assert.equal(verifyChain(chain).ok, true, 'the chain stays intact through a failure');
});
