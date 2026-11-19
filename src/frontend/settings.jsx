/**
 * settings.jsx — the rule pack editor, per project.
 *
 * This page is the product's actual control surface. Onboarding a team is
 * authoring a rule pack here; it is not changing code, and it is not asking an
 * administrator to trust a model more.
 *
 * The master switch is shown first and labelled plainly, because the honest
 * default is that it is off and somebody has to choose otherwise.
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
  Toggle,
  Textfield,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [pack, setPack] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const r = await invoke('getRulePack', {});
    if (r.ok) {
      setPack(r.rulePack);
      setError(null);
    } else {
      setError(r.error);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (error) {
    return (
      <SectionMessage appearance="error" title="Could not load the rule pack">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }
  if (!pack) return <Spinner label="Loading the rule pack" />;

  const save = async (next) => {
    setBusy(true);
    setNotice(null);
    const r = await invoke('saveRulePack', { rulePack: next });
    setBusy(false);
    if (r.ok) {
      setPack(r.rulePack);
      setNotice({
        appearance: 'success',
        // Saying the version moved matters: it is what makes any verdict decided
        // under the old rules detectably stale instead of silently executable.
        text: `Saved as v${r.rulePack.version}. Any verdict decided under v${r.rulePack.version - 1} is now stale and cannot be executed.`,
      });
    } else {
      setNotice({ appearance: 'error', text: r.error });
    }
  };

  const loadDemo = async (which) => {
    setBusy(true);
    setNotice(null);
    const r = await invoke('loadDemoRulePack', { which });
    setBusy(false);
    if (r.ok) {
      setPack(r.rulePack);
      setNotice({ appearance: 'success', text: `Loaded the ${which} demo pack as v${r.rulePack.version}.` });
    } else {
      setNotice({ appearance: 'error', text: r.error });
    }
  };

  const actionRows = pack.actions.map((a) => ({
    key: a.id,
    cells: [
      { content: <Code>{a.id}</Code> },
      { content: <Text>{a.title}</Text> },
      { content: <Code>{a.effect}</Code> },
      {
        content: (
          <Lozenge appearance={a.maxDisposition === 'auto' ? 'success' : 'inprogress'}>
            {a.maxDisposition === 'auto' ? 'may run unattended' : 'always a human'}
          </Lozenge>
        ),
      },
      {
        content: (
          <Lozenge appearance={a.reversible ? 'default' : 'removed'}>
            {a.reversible ? 'reversible' : 'irreversible'}
          </Lozenge>
        ),
      },
      { content: <Text>{a.allowedValues?.length ? a.allowedValues.join(', ') : '—'}</Text> },
    ],
  }));

  return (
    <Stack space="space.300">
      <Stack space="space.050">
        <Heading as="h2">Gatekeeper rules — {pack.projectKey}</Heading>
        <Text>
          <Em>
            {pack.name} · version {pack.version}
          </Em>
        </Text>
      </Stack>

      {notice ? (
        <SectionMessage appearance={notice.appearance}>
          <Text>{notice.text}</Text>
        </SectionMessage>
      ) : null}

      <Stack space="space.100">
        <Heading as="h4">Unattended action</Heading>
        <Inline space="space.100" alignBlock="center">
          <Toggle
            isChecked={pack.unattendedAllowed}
            isDisabled={busy}
            onChange={() => save({ ...pack, unattendedAllowed: !pack.unattendedAllowed })}
            label="Allow unattended action"
          />
          <Text>
            <Strong>{pack.unattendedAllowed ? 'ON' : 'OFF'}</Strong> —{' '}
            {pack.unattendedAllowed
              ? 'actions cleared below may run without a human, after passing all eleven rules.'
              : 'every proposal is held for a human, whatever the rules below say.'}
          </Text>
        </Inline>
        {!pack.unattendedAllowed ? (
          <Text>
            <Em>
              This is the default for a new project. Nothing changes what happens to your incident queue until somebody
              turns it on deliberately.
            </Em>
          </Text>
        ) : null}
      </Stack>

      <Stack space="space.100">
        <Heading as="h4">Confidence floor</Heading>
        <Inline space="space.100" alignBlock="center">
          <Textfield
            name="floor"
            value={String(pack.confidenceFloor)}
            isDisabled={busy}
            onChange={(e) => {
              const v = Number(e.target.value);
              // Refuse out-of-range rather than clamping: a floor silently
              // rewritten from 9 to 1 would read as "nothing can ever pass"
              // while looking like a typo that was accepted.
              if (Number.isFinite(v) && v >= 0 && v <= 1) save({ ...pack, confidenceFloor: v });
              else setNotice({ appearance: 'error', text: 'The confidence floor must be between 0 and 1.' });
            }}
          />
          <Text>
            A proposal below this is held by rule R06. This is a floor on a number the model reports about itself, so it
            catches admitted uncertainty — not confident errors. R07 and R08 cover those.
          </Text>
        </Inline>
      </Stack>

      <Stack space="space.100">
        <Heading as="h4">What this project permits</Heading>
        <DynamicTable
          head={{
            cells: [
              { key: 'id', content: 'Action' },
              { key: 'title', content: 'What it does' },
              { key: 'effect', content: 'Effect' },
              { key: 'ceiling', content: 'Ceiling' },
              { key: 'rev', content: 'Reversible' },
              { key: 'values', content: 'Permitted values' },
            ],
          }}
          rows={actionRows}
        />
        <Text>
          <Em>
            An agent can only ever choose from this list. An action id that is not here is refused by rule R01 before
            anything happens.
          </Em>
        </Text>
      </Stack>

      <Stack space="space.100">
        <Heading as="h4">Demo packs</Heading>
        <Text>
          Two packs with deliberately different postures, so you can run the same incident twice and watch the verdict
          change with no code change.
        </Text>
        <Inline space="space.100">
          <Button isDisabled={busy} onClick={() => loadDemo('northwind')}>
            Load northwind-msp (unattended ON, floor 0.75)
          </Button>
          <Button isDisabled={busy} onClick={() => loadDemo('acme')}>
            Load acme-retail (unattended OFF, floor 0.90)
          </Button>
        </Inline>
      </Stack>
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
