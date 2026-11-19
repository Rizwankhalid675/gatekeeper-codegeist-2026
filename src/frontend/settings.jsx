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

/**
 * The five effects an action may name. This list is the executor's dispatch
 * table, so the editor offers exactly these and nothing else — an administrator
 * cannot type an effect that has no implementation behind it.
 */
const EFFECTS = ['comment', 'label', 'link', 'transition', 'assign'];

/** Ids appear in receipts, in agent prompts and in rule details, so keep them machine-shaped. */
const ID_SHAPE = /^[a-z0-9][a-z0-9-]{1,48}$/;

const App = () => {
  const [pack, setPack] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState(null);
  const [projectKey, setProjectKey] = useState(null);

  // The add-an-action form. Held here rather than in a child component because
  // ActionEditor is re-created on every render, so any state inside it would be
  // thrown away as the user typed.
  //
  // The text fields are UNCONTROLLED (defaultValue, not value) and that is
  // load-bearing. A controlled Textfield in UI Kit re-renders through the
  // iframe bridge on every keystroke and snaps the field back to the state it
  // was given, so typing outruns the round trip and all but the last character
  // is lost. Found live: "escalate-to-vendor" arrived as "!".
  //
  // `formKey` is bumped after a successful add to remount the fields, which is
  // how an uncontrolled input gets cleared.
  const [adding, setAdding] = useState(false);
  const [newId, setNewId] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [newEffect, setNewEffect] = useState('comment');
  const [formKey, setFormKey] = useState(0);
  const [history, setHistory] = useState(null);

  const safeInvoke = (name, payload) =>
    invoke(name, payload).catch((e) => ({
      ok: false,
      error: `The Gatekeeper resolver did not respond: ${e?.message || e}`,
    }));

  const loadHistory = async (key) => {
    const h = await safeInvoke('getRulePackHistory', key ? { projectKey: key } : {});
    setHistory(h.ok ? h : null);
  };

  const load = async (key) => {
    const r = await safeInvoke('getRulePack', key ? { projectKey: key } : {});
    if (r.ok) {
      setPack(r.rulePack);
      setProjectKey(r.rulePack.projectKey);
      setError(null);
      await loadHistory(r.rulePack.projectKey);
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
    // `basedOnVersion` is what makes a lost update detectable. Without it, two
    // administrators in two tabs each save the pack they loaded and the second
    // silently discards the first — including, say, a tightening somebody made
    // in response to an incident.
    const r = await safeInvoke('saveRulePack', { rulePack: next, basedOnVersion: pack.version });
    setBusy(false);

    if (r.conflict) {
      // Show them what is actually stored now, rather than leaving the screen
      // displaying a pack that no longer exists.
      if (r.rulePack) setPack(r.rulePack);
      await loadHistory(pack.projectKey);
      setNotice({ appearance: 'error', text: r.error });
      return;
    }
    if (!r.ok) {
      setNotice({ appearance: 'error', text: r.error });
      return;
    }

    setPack(r.rulePack);
    await loadHistory(r.rulePack.projectKey);

    if (r.unchanged) {
      // A version bump makes every pending verdict stale, so it is not spent on
      // a save that changed nothing.
      setNotice({ appearance: 'information', text: 'Nothing changed, so nothing was saved and the version did not move.' });
      return;
    }

    const widened = (r.changes || []).filter((c) => c.widens);
    setNotice({
      appearance: widened.length > 0 ? 'warning' : 'success',
      // Saying the version moved matters: it is what makes any verdict decided
      // under the old rules detectably stale instead of silently executable.
      // Saying what WIDENED matters more — that is the change somebody will ask
      // about later.
      text:
        `Saved as v${r.rulePack.version}. Any verdict decided under v${r.rulePack.version - 1} is now stale and cannot be executed.` +
        (widened.length > 0 ? ` This widens what a robot may do: ${widened.map((c) => c.text).join('; ')}.` : ''),
    });
  };

  const loadDemo = async (which) => {
    setBusy(true);
    setNotice(null);
    const r = await safeInvoke('loadDemoRulePack', { which, projectKey: pack.projectKey });
    setBusy(false);
    if (r.ok) {
      setPack(r.rulePack);
      await loadHistory(r.rulePack.projectKey);
      setNotice({ appearance: 'success', text: `Loaded the ${which} demo pack as v${r.rulePack.version}.` });
    } else {
      setNotice({ appearance: 'error', text: r.error });
    }
  };

  /**
   * Change one field on one action and save the whole pack. saveRulePack
   * validates and bumps the version, which is what makes any verdict decided
   * under the previous rules detectably stale — so editing the allow-list here
   * cannot retroactively authorise something the gate already held.
   */
  const updateAction = (id, patch) =>
    save({ ...pack, actions: pack.actions.map((a) => (a.id === id ? { ...a, ...patch } : a)) });

  /**
   * Removing an action narrows what any agent may ever propose: R01 refuses the
   * id outright from the next version on. It is the conservative direction, so
   * it takes one click — and the version bump means a verdict already decided
   * under the old pack cannot be executed afterwards either.
   */
  const removeAction = (id) => save({ ...pack, actions: pack.actions.filter((a) => a.id !== id) });

  /**
   * Adding one widens it, which is why this validates before it saves and why a
   * new action arrives capped at `hold`. Clearing it for unattended use is a
   * second, deliberate act on the toggle above — not a side effect of adding it.
   */
  const addAction = () => {
    const id = newId.trim().toLowerCase();
    const title = newTitle.trim();

    if (!ID_SHAPE.test(id)) {
      setNotice({
        appearance: 'error',
        text: 'An action id must be lowercase letters, digits and hyphens, 2–49 characters — it is quoted verbatim in receipts and agent prompts.',
      });
      return;
    }
    if (pack.actions.some((a) => a.id === id)) {
      setNotice({ appearance: 'error', text: `This project already permits "${id}".` });
      return;
    }
    if (!title) {
      setNotice({
        appearance: 'error',
        text: 'Give the action a title. It is what a responder reads when the gate holds it for them.',
      });
      return;
    }

    setAdding(false);
    setNewId('');
    setNewTitle('');
    setNewEffect('comment');
    setFormKey((k) => k + 1);
    save({
      ...pack,
      actions: [...pack.actions, { id, title, effect: newEffect, maxDisposition: 'hold', reversible: true, allowedValues: [] }],
    });
  };

  const ActionEditor = ({ a }) => (
    <Stack space="space.100">
      <Inline space="space.100" alignBlock="center">
        <Code>{a.id}</Code>
        <Text>
          <Strong>{a.title}</Strong>
        </Text>
        <Lozenge>{a.effect}</Lozenge>
        <Button appearance="subtle" isDisabled={busy} onClick={() => removeAction(a.id)}>
          Remove
        </Button>
      </Inline>

      <Inline space="space.200" alignBlock="center">
        <Inline space="space.075" alignBlock="center">
          <Toggle
            isChecked={a.maxDisposition === 'auto'}
            isDisabled={busy}
            onChange={() => updateAction(a.id, { maxDisposition: a.maxDisposition === 'auto' ? 'hold' : 'auto' })}
            label={`May run unattended: ${a.id}`}
          />
          <Text>{a.maxDisposition === 'auto' ? 'may run unattended' : 'always a human'}</Text>
        </Inline>

        <Inline space="space.075" alignBlock="center">
          <Toggle
            isChecked={a.reversible !== false}
            isDisabled={busy}
            onChange={() => updateAction(a.id, { reversible: a.reversible === false })}
            label={`Reversible: ${a.id}`}
          />
          <Text>{a.reversible === false ? 'irreversible — always held by R10' : 'reversible'}</Text>
        </Inline>
      </Inline>

      <Inline space="space.100" alignBlock="center">
        <Textfield
          name={`values-${a.id}`}
          defaultValue={(a.allowedValues || []).join(', ')}
          isDisabled={busy}
          placeholder="comma separated; empty means any value"
          onBlur={(e) => {
            const next = String(e.target.value || '')
              .split(',')
              .map((v) => v.trim())
              .filter(Boolean);
            const current = a.allowedValues || [];
            if (next.join('\u0000') !== current.join('\u0000')) updateAction(a.id, { allowedValues: next });
          }}
        />
        <Text>
          <Em>permitted values — R02 rejects anything else</Em>
        </Text>
      </Inline>
    </Stack>
  );

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
              ? 'actions cleared below may run without a human, after passing all twelve rules.'
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
            // Uncontrolled, and saved on blur rather than on change. Typing
            // "0.9" into a controlled field that saves per keystroke writes
            // three rule pack versions and leaves the floor at 0 in between —
            // an interval in which every proposal clears R06. Keyed on the
            // version so a save elsewhere still refreshes what is shown.
            key={`floor-${pack.version}`}
            name="floor"
            defaultValue={String(pack.confidenceFloor)}
            isDisabled={busy}
            onBlur={(e) => {
              const raw = String(e.target.value || '').trim();
              const v = Number(raw);
              if (raw === '' || !Number.isFinite(v) || v < 0 || v > 1) {
                // Refuse out-of-range rather than clamping: a floor silently
                // rewritten from 9 to 1 would read as "nothing can ever pass"
                // while looking like a typo that was accepted.
                setNotice({ appearance: 'error', text: 'The confidence floor must be a number between 0 and 1.' });
                return;
              }
              if (v !== pack.confidenceFloor) save({ ...pack, confidenceFloor: v });
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
        {pack.actions.length === 0 ? (
          <SectionMessage appearance="warning" title="This project permits nothing">
            <Text>
              Every action an agent proposes will be refused by rule R01. Gatekeeper will still correlate, diagnose and
              hold incidents for a human — it simply cannot act on any of them.
            </Text>
          </SectionMessage>
        ) : (
          pack.actions.map((a) => <ActionEditor key={a.id} a={a} />)
        )}
        <Text>
          <Em>
            An agent can only ever choose from this list. An action id that is not here is refused by rule R01 before
            anything happens.
          </Em>
        </Text>

        {adding ? (
          <Stack space="space.100">
            <Heading as="h5">Add an action</Heading>
            <Inline space="space.100" alignBlock="center">
              <Textfield
                key={`new-id-${formKey}`}
                name="new-id"
                defaultValue=""
                isDisabled={busy}
                placeholder="action id, e.g. label-needs-vendor"
                onChange={(e) => setNewId(e.target.value)}
                onBlur={(e) => setNewId(e.target.value)}
              />
              <Textfield
                key={`new-title-${formKey}`}
                name="new-title"
                defaultValue=""
                isDisabled={busy}
                placeholder="what a responder reads when it is held"
                onChange={(e) => setNewTitle(e.target.value)}
                onBlur={(e) => setNewTitle(e.target.value)}
              />
            </Inline>
            <Inline space="space.100" alignBlock="center">
              <Text>
                <Em>effect</Em>
              </Text>
              {EFFECTS.map((eff) => (
                <Button
                  key={eff}
                  appearance={newEffect === eff ? 'primary' : 'default'}
                  isDisabled={busy}
                  onClick={() => setNewEffect(eff)}
                >
                  {eff}
                </Button>
              ))}
            </Inline>
            <Text>
              <Em>
                These five are the executor's whole dispatch table. There is no path from an agent's output to any
                other Jira call, so an action cannot name an effect that has no code behind it.
              </Em>
            </Text>
            <Inline space="space.100">
              <Button appearance="primary" isDisabled={busy} onClick={addAction}>
                Add it
              </Button>
              <Button isDisabled={busy} onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </Inline>
            <Text>
              It arrives <Strong>capped at hold</Strong> with no permitted values. Clearing it for unattended use is a
              separate, deliberate click above.
            </Text>
          </Stack>
        ) : (
          <Inline space="space.100">
            <Button isDisabled={busy} onClick={() => setAdding(true)}>
              Add an action
            </Button>
          </Inline>
        )}
        <SectionMessage appearance="warning" title="An empty permitted-values box means ANY value">
          <Text>
            R02 only restricts an action when it has permitted values. Clearing the box does not lock the action down,
            it opens it up — the agent may then pass any value the effect accepts.
          </Text>
        </SectionMessage>
        <SectionMessage appearance="warning" title="Transition names are per-workflow">
          <Text>
            The permitted values for <Code>transition-issue</Code> must match this project's workflow exactly, and the
            defaults shipped here are generic placeholders that will not match most workflows. Gatekeeper does not
            guess: if a name is not available on the issue it refuses the action and names the ones that are, which is
            the quickest way to find the right values — but it finds them at execution time, not here.
          </Text>
        </SectionMessage>
      </Stack>

      {/* The rule pack has receipts of its own. Gatekeeper recorded every
          action a robot took and nothing about the person who decided what
          robots may do, which is the more consequential of the two. */}
      <Stack space="space.100">
        <Heading as="h4">Who changed these rules</Heading>
        {!history ? (
          <Text>
            <Em>History unavailable.</Em>
          </Text>
        ) : history.chain.length === 0 ? (
          <Text>
            <Em>No changes recorded yet. Every save from here on is written to a chained, tamper-evident record.</Em>
          </Text>
        ) : (
          <Stack space="space.100">
            <Text>
              {history.verification?.ok ? (
                <Lozenge appearance="success">Chain verified — {history.chain.length} change(s)</Lozenge>
              ) : (
                <Lozenge appearance="removed">
                  Chain BROKEN at {history.verification?.at}: {history.verification?.problem}
                </Lozenge>
              )}
            </Text>
            {history.chain.map((r) => (
              <Stack key={r.digest} space="space.025">
                <Inline space="space.100" alignBlock="center">
                  <Lozenge appearance={/WIDENS/.test(r.reason) ? 'moved' : 'default'}>
                    {/WIDENS/.test(r.reason) ? 'widened' : 'changed'}
                  </Lozenge>
                  <Text>
                    <Strong>v{r.rulePackVersion}</Strong>
                  </Text>
                  <Code>{r.actor}</Code>
                  <Text>{r.at}</Text>
                </Inline>
                <Text>{r.reason}</Text>
                <Text>
                  <Em>
                    rules <Code>{r.evidenceDigest.slice(0, 12)}</Code> · receipt <Code>{r.digest.slice(0, 12)}</Code>{' '}
                    (prev <Code>{r.prev.slice(0, 12)}</Code>)
                  </Em>
                </Text>
              </Stack>
            ))}
          </Stack>
        )}
        <Text>
          <Em>
            Every change is chained by sha256 the same way an incident's receipts are. Editing an earlier entry breaks
            the verification above rather than quietly rewriting what happened.
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
