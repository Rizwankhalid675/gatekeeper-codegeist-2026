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
  const [projects, setProjects] = useState(null);
  const [projectKey, setProjectKey] = useState(null);

  const safeInvoke = (name, payload) =>
    invoke(name, payload).catch((e) => ({
      ok: false,
      error: `The Gatekeeper resolver did not respond: ${e?.message || e}`,
    }));

  const load = async (key) => {
    const r = await safeInvoke('getRulePack', key ? { projectKey: key } : {});
    if (r.ok) {
      setPack(r.rulePack);
      setProjectKey(r.rulePack.projectKey);
      setError(null);
    } else {
      setError(r.error);
    }
  };

  // A global page has no project in its context, so the editor has to ask which
  // project is being configured. A project settings page does have one, and
  // then this picker never appears.
  useEffect(() => {
    (async () => {
      const b = await safeInvoke('bootstrap', {});
      if (!b.ok) {
        setError(b.error);
        return;
      }
      setProjects(b.projects);
      if (b.contextProjectKey) await load(b.contextProjectKey);
    })();
  }, []);

  if (error) {
    return (
      <SectionMessage appearance="error" title="Could not load the rule pack">
        <Text>{error}</Text>
      </SectionMessage>
    );
  }

  if (!pack) {
    if (!projects) return <Spinner label="Loading" />;
    return (
      <Stack space="space.200">
        <Heading as="h2">Gatekeeper rules</Heading>
        <Text>
          Choose the project to configure. A rule pack is per project — onboarding a team is authoring one of these,
          not changing code.
        </Text>
        {projects.length === 0 ? (
          <SectionMessage appearance="warning" title="No projects visible">
            <Text>Gatekeeper cannot see any projects on this site.</Text>
          </SectionMessage>
        ) : (
          <Stack space="space.100">
            {projects.map((p) => (
              <Inline key={p.key} space="space.100" alignBlock="center">
                <Button isDisabled={busy} onClick={() => load(p.key)}>
                  {p.key}
                </Button>
                <Text>{p.name}</Text>
              </Inline>
            ))}
          </Stack>
        )}
      </Stack>
    );
  }

  const save = async (next) => {
    setBusy(true);
    setNotice(null);
    const r = await safeInvoke('saveRulePack', { rulePack: next });
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
    const r = await safeInvoke('loadDemoRulePack', { which, projectKey: pack.projectKey });
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
        <SectionMessage appearance="warning" title="Transition names are per-workflow">
          <Text>
            The permitted values for <Code>transition-issue</Code> must match this project's workflow exactly, and the
            defaults shipped here are generic placeholders that will not match most workflows. Gatekeeper does not
            guess: if a name is not available on the issue it refuses the action and names the ones that are, which is
            the quickest way to find the right values — but it finds them at execution time, not here.
          </Text>
        </SectionMessage>
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
