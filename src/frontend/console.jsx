/**
 * console.jsx — the operator console, on the issue.
 *
 * Renders what the resolver gives it and computes nothing. No policy logic in
 * the front end: a second copy of the rules here would drift out of step with
 * the gate, and the panel would start telling operators something the gate does
 * not believe.
 *
 * What it is for: an operator at 3am should be able to answer "why did this
 * happen, and can I trust the record" without opening the code.
 */

import React, { useEffect, useState } from 'react';
import ForgeReconciler, {
  Button,
  Code,
  DynamicTable,
  Em,
  Heading,
  Inline,
  Lozenge,
  SectionMessage,
  Spinner,
  Stack,
  Strong,
  Text,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const DISPOSITION_APPEARANCE = {
  auto: 'success',
  hold: 'inprogress',
  reject: 'removed',
};

const EVENT_APPEARANCE = {
  executed: 'success',
  suppressed: 'default',
  held: 'inprogress',
  rejected: 'removed',
  overridden: 'moved',
};

function Verdict({ verdict, stale }) {
  if (!verdict) {
    return (
      <SectionMessage title="Nothing decided yet">
        <Text>
          Ask the Gatekeeper agent to triage this issue. Correlation and the eleven-rule gate run before anything is
          touched.
        </Text>
      </SectionMessage>
    );
  }

  const fired = verdict.outcomes.filter((o) => o.fired);
  const passed = verdict.outcomes.filter((o) => !o.fired);

  return (
    <Stack space="space.200">
      <Inline space="space.100" alignBlock="center">
        <Lozenge appearance={DISPOSITION_APPEARANCE[verdict.disposition] || 'default'} isBold>
          {verdict.disposition}
        </Lozenge>
        <Text>
          <Strong>{verdict.reason}</Strong>
        </Text>
      </Inline>

      {stale ? (
        <SectionMessage appearance="warning" title="This verdict is out of date">
          <Text>
            The issue has changed since this was decided, so the verdict no longer matches the evidence. Re-run triage
            before acting on it.
          </Text>
        </SectionMessage>
      ) : null}

      <Text>
        <Em>
          Rule pack v{verdict.rulePackVersion} · evidence <Code>{String(verdict.evidenceDigest).slice(0, 12)}</Code> ·
          decided {verdict.decidedAt}
        </Em>
      </Text>

      {fired.length > 0 ? (
        <Stack space="space.050">
          <Text>
            <Strong>Rules that fired</Strong>
          </Text>
          {fired.map((o) => (
            <Text key={o.rule}>
              <Lozenge appearance="removed">{o.rule}</Lozenge> {o.title} — {o.detail}
            </Text>
          ))}
        </Stack>
      ) : null}

      {/* The rules that PASSED are shown too. An operator looking at a hold
          needs to see that the other ten cleared, or they cannot tell a
          specific objection from a blanket refusal. */}
      <Stack space="space.050">
        <Text>
          <Strong>Rules that passed ({passed.length} of 11)</Strong>
        </Text>
        {passed.map((o) => (
          <Text key={o.rule}>
            <Lozenge appearance="success">{o.rule}</Lozenge> {o.title} — {o.detail}
          </Text>
        ))}
      </Stack>
    </Stack>
  );
}

function Handoff({ handoff }) {
  if (!handoff?.proposal) {
    return (
      <Text>
        <Em>No agent has proposed anything on this issue yet.</Em>
      </Text>
    );
  }

  const { proposal, review } = handoff;

  return (
    <Stack space="space.150">
      <Stack space="space.050">
        <Inline space="space.100" alignBlock="center">
          <Lozenge appearance="new">proposer</Lozenge>
          <Text>
            <Strong>confidence {Number(proposal.confidence).toFixed(2)}</Strong>
          </Text>
          {proposal.action ? <Code>{proposal.action.id}</Code> : <Em>no action, diagnosis only</Em>}
        </Inline>
        <Text>{proposal.rationale}</Text>
        {proposal.quotes?.length ? (
          <Text>
            <Em>cited: {proposal.quotes.map((q) => `"${q}"`).join(' · ')}</Em>
          </Text>
        ) : null}
      </Stack>

      {review ? (
        <Stack space="space.050">
          <Inline space="space.100" alignBlock="center">
            <Lozenge appearance={review.verdict === 'confirm' ? 'success' : 'removed'}>reviewer</Lozenge>
            <Text>
              <Strong>{review.verdict}</Strong>
            </Text>
          </Inline>
          <Text>{review.rationale}</Text>
          {review.quotes?.length ? (
            <Text>
              <Em>cited: {review.quotes.map((q) => `"${q}"`).join(' · ')}</Em>
            </Text>
          ) : null}
        </Stack>
      ) : (
        <Text>
          <Em>
            No adversarial review on the record. Nothing runs unattended without one — that is rule R07, not an
            oversight.
          </Em>
        </Text>
      )}
    </Stack>
  );
}

function Evidence({ evidence }) {
  const { correlation } = evidence;

  return (
    <Stack space="space.150">
      <Inline space="space.100" alignBlock="center">
        {correlation.suppress ? (
          <Lozenge appearance="default" isBold>
            suppressed: {correlation.reason}
          </Lozenge>
        ) : (
          <Lozenge appearance="new" isBold>
            paged
          </Lozenge>
        )}
        <Text>
          seen {correlation.signatureCount}× in the window
          {correlation.relatedIssueKeys.length ? ` · related: ${correlation.relatedIssueKeys.join(', ')}` : ''}
        </Text>
      </Inline>

      <Text>
        <Em>
          Evidence digest <Code>{String(evidence.digest).slice(0, 12)}</Code>. This is what the agents saw; the executor
          refuses any verdict that does not match it.
        </Em>
      </Text>

      <Stack space="space.050">
        {evidence.items.map((i) => (
          <Text key={i.id}>
            {/* `source` is the field the quote check keys on, so it is shown
                rather than hidden: an operator can see why quoting a particular
                item would not corroborate anything. */}
            <Lozenge appearance={i.source ? 'success' : 'moved'}>{i.source ? 'source' : 'derived'}</Lozenge>{' '}
            <Code>{i.kind}</Code> {i.text}
          </Text>
        ))}
      </Stack>
    </Stack>
  );
}

function Receipts({ receipts, chainVerified, chainProblem }) {
  if (!receipts?.length) {
    return (
      <Text>
        <Em>No receipts yet. Every decision writes one, including the ones that do nothing.</Em>
      </Text>
    );
  }

  const head = [
    { key: 'seq', content: '#' },
    { key: 'event', content: 'Event' },
    { key: 'actor', content: 'Actor' },
    { key: 'action', content: 'Action' },
    { key: 'reason', content: 'Reason' },
    { key: 'digest', content: 'Digest' },
  ];

  const rows = receipts.map((r) => ({
    key: r.seq,
    cells: [
      { content: <Text>{r.seq}</Text> },
      { content: <Lozenge appearance={EVENT_APPEARANCE[r.event] || 'default'}>{r.event}</Lozenge> },
      { content: <Text>{r.actor}</Text> },
      { content: r.action ? <Code>{r.action}</Code> : <Text>—</Text> },
      { content: <Text>{r.reason}</Text> },
      { content: <Code>{r.digest}</Code> },
    ],
  }));

  return (
    <Stack space="space.150">
      {chainVerified ? (
        <SectionMessage appearance="success" title={`Chain verified — ${receipts.length} receipt(s)`}>
          <Text>
            Every receipt's digest was recomputed and every link checked. Editing any earlier entry would break this.
          </Text>
        </SectionMessage>
      ) : (
        <SectionMessage appearance="error" title="The receipt chain does not verify">
          <Text>{chainProblem}</Text>
        </SectionMessage>
      )}
      <DynamicTable head={head} rows={rows} />
    </Stack>
  );
}

const App = () => {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = async () => {
    setData(await invoke('getConsole'));
  };

  useEffect(() => {
    load();
  }, []);

  if (!data) return <Spinner label="Loading Gatekeeper" />;
  if (!data.ok) {
    return (
      <SectionMessage appearance="error" title="Gatekeeper could not load">
        <Text>{data.error}</Text>
      </SectionMessage>
    );
  }

  const canApprove = data.verdict?.disposition === 'hold' && data.verdict?.action && !data.verdictIsStale;

  const approve = async () => {
    setBusy(true);
    setNotice(null);
    const result = await invoke('approveHeldAction');
    setBusy(false);
    setNotice(
      result.ok
        ? { appearance: 'success', text: `Executed "${result.action}" as you. Receipt ${result.receipt}.` }
        : { appearance: 'error', text: result.error },
    );
    await load();
  };

  return (
    <Stack space="space.300">
      <Stack space="space.050">
        <Heading as="h3">{data.issueKey}</Heading>
        <Text>
          <Em>
            {data.rulePack.name} · v{data.rulePack.version} · floor {data.rulePack.confidenceFloor} ·{' '}
            {data.rulePack.unattendedAllowed ? 'unattended action enabled' : 'unattended action OFF'}
          </Em>
        </Text>
      </Stack>

      {notice ? (
        <SectionMessage appearance={notice.appearance}>
          <Text>{notice.text}</Text>
        </SectionMessage>
      ) : null}

      <Stack space="space.100">
        <Heading as="h4">The verdict</Heading>
        <Verdict verdict={data.verdict} stale={data.verdictIsStale} />
        {canApprove ? (
          <Inline space="space.100">
            <Button appearance="primary" isDisabled={busy} onClick={approve}>
              {busy ? 'Working…' : `Take this action myself (${data.verdict.action.id})`}
            </Button>
          </Inline>
        ) : null}
      </Stack>

      <Stack space="space.100">
        <Heading as="h4">The agent handoff</Heading>
        <Handoff handoff={data.handoff} />
      </Stack>

      <Stack space="space.100">
        <Heading as="h4">The evidence</Heading>
        <Evidence evidence={data.evidence} />
      </Stack>

      <Stack space="space.100">
        <Heading as="h4">The receipts</Heading>
        <Receipts receipts={data.receipts} chainVerified={data.chainVerified} chainProblem={data.chainProblem} />
      </Stack>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
