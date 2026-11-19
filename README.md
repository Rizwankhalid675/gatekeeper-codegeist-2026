# Gatekeeper

**Agentic incident triage for Jira Service Management: the model proposes, deterministic code decides, nothing executes without a receipt.**

Built for **Codegeist 2026** · Category: **Apps for Software Teams** · Bonus: **Best Agents** (`rovo:agent`), **Best app with Atlassian MCP** (`rovo:mcp`)

**Install link:** _added at submission_ · **Demo video:** _added at submission_ · **Limits:** [what doesn't work yet](#honest-limits)

**New & Existing (rules §4).** Gatekeeper was **newly created** by the entrant during the
submission period, on Forge, with a Forge manifest and six Forge modules. The architecture
carries forward from an earlier project of mine that targeted a different platform and was
never entered anywhere — the idea travels, no code does.

**Node 22.x or 24.x.** The Forge CLI does not support Node 26 and warns on it.

---

## The problem, in one paragraph

A service desk does not have a detection problem. It has a volume problem. The obvious fix is
to let a language model read the queue and act on it — and that is unacceptable the moment the
queue belongs to someone else's production system. Gatekeeper is built the other way round: the
agents are load-bearing and untrusted, and the authority to change anything sits in
deterministic code that no model can influence.

Three trust levels, and they are the architecture:

| Layer | Trust | What it decides |
|---|---|---|
| Correlation | deterministic, **fully trusted** | whether an alert deserves attention at all |
| Agents (Rovo) | **untrusted**, load-bearing | what is wrong and what to do about it |
| Policy gate + executor | deterministic, **fully trusted** | whether a robot may act, and then acting |

---

## How Gatekeeper meets the judging criteria

| Criterion | How we meet it | Where to see it |
|---|---|---|
| Technological Implementation | Two Rovo agents with separated duties, an eleven-rule gate that is a pure function, an executor that re-derives its own authorisation, and a sha256 receipt chain. 119 tests, no Forge runtime needed to run them. | [`src/gate/gate.js`](src/gate/gate.js), [`src/executor.js`](src/executor.js), `npm test` |
| Design | A finished product surface, not a proof of concept: the console shows the evidence, the agent handoff, **all eleven rules including the ones that passed**, and the receipt chain with its verification state. A project settings page where onboarding a team is authoring a rule pack. | [`src/frontend/console.jsx`](src/frontend/console.jsx), [`src/frontend/settings.jsx`](src/frontend/settings.jsx) |
| Potential Impact | The failure mode this addresses is specific and current: teams are being asked to let agents act on production incidents, with "the model said so" as the audit trail. Gatekeeper is a shape for doing it that an administrator can actually sign off. | §1 below, [`docs/LIMITS.md`](docs/LIMITS.md) |
| Innovation/Idea | The reviewer's citations are re-verified against **source evidence only**, so one agent cannot corroborate another by quoting it back. A fabricated citation is detected and holds the action. Most entries in this space ask you to trust the model more; this one is built to be trusted less. | [`verifyQuotes`](src/gate/evidence.js), rule R08 |
| Presentation | One unbroken demo path, scripted beat by beat, with the fabricated-citation hold as the centrepiece. | [`VIDEO.md`](VIDEO.md), [`DEMO-RUNBOOK.md`](DEMO-RUNBOOK.md) |

---

## 1. What actually happens to one incident

```
Jira issue
    │
    ▼
┌─────────────────────────────────────────────┐
│ CORRELATION — deterministic, trusted        │  signature normalise, duplicate
│ suppress with a written reason, or pass on  │  window, flap detect, maintenance
└─────────────────────────────────────────────┘  window, known-benign list
    │                                            no model is consulted here
    ▼
┌─────────────────────────────────────────────┐
│ EVIDENCE BUNDLE  digest = sha256(canonical) │  every item flagged source: true/false
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ gatekeeper-agent      (rovo:agent)          │  proposes: rationale, confidence,
│   → triage-incident                         │  an action id from the rule pack,
└─────────────────────────────────────────────┘  and the quotes it relied on
    │
    ▼
┌─────────────────────────────────────────────┐
│ gatekeeper-reviewer   (rovo:agent)          │  separate prompt, separate module,
│   → review-proposal                         │  blind to the proposer's confidence
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ POLICY GATE — 11 rules, pure function       │  R01-R03 reject · R04-R11 hold
│ reject · hold · auto                        │  all eleven reported, every time
└─────────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────────┐
│ EXECUTOR — re-derives the verdict itself    │  a forged, stale or replayed
│ five allow-listed effects, nothing else     │  verdict cannot cause an action
└─────────────────────────────────────────────┘
    │
    ▼
  sha256 receipt chain + a comment on the issue
```

### The eleven rules

Three reject, eight hold. The gate can only ever make the outcome **more** conservative than
the agent asked for — there is no input that escalates one.

| | Rule | Fires when | Forces |
|---|---|---|---|
| R01 | Action exists in the rule pack | the agent named an action nobody authorised | reject |
| R02 | Parameters are permitted values | the action is allowed but this value is not | reject |
| R03 | Proposal matches the evidence we hold | the issue moved under the agent, or it is a replay | reject |
| R04 | Project allows unattended action | the master switch is off | hold |
| R05 | Action is cleared for unattended use | the admin capped this action at `hold` | hold |
| R06 | Confidence at or above the floor | the model admitted uncertainty | hold |
| R07 | Adversarial reviewer confirms | the reviewer dissented, **or nothing reviewed it** | hold |
| R08 | Citations appear in source evidence | a quote was fabricated | hold |
| R09 | Priority does not mandate a human | e.g. Highest always goes to a person | hold |
| R10 | Action is reversible | the action cannot be undone | hold |
| R11 | Not inside a maintenance window | planned work is in progress | hold |

Why R07 fires on a *missing* review and not just a dissent: passing an unreviewed proposal
would make the reviewer decorative. The one case where review gets skipped is the case where
nothing checked the proposal at all.

### The part that is genuinely different

`quoteIsReal`, in three lines of consequence:

```js
const haystack = bundle.items
  .filter((i) => i.source === true)   // ← source evidence ONLY
  .map((i) => normaliseForQuoteMatch(i.text))
  .join('\n');
```

The reviewer can see the diagnosis it is reviewing — it has to. So if quotes were matched
against the whole bundle, a reviewer could "corroborate" a diagnosis by quoting that diagnosis
back at itself. That is not corroboration. Agent-produced items, and Gatekeeper's own prior
comments, are excluded from the haystack.

The check is deliberately forgiving about formatting and completely unforgiving about content:
whitespace, case and smart quotes are folded, so a reformatted real sentence passes; an invented
one does not. And it is recomputed **inside the gate**, so a `quotesVerified: true` flag
arriving from upstream changes nothing. There is a test named after exactly that:

```
✔ R08 recomputes the citation check and ignores the flag it was handed
```

### Why the executor does not trust its own verdict

The verdict travels through storage and across invocations. So "a forged verdict cannot cause
an action" has to be a property of the executor, not an assumption about the code before it.
`execute()` re-runs the gate from the rule pack and the evidence, and acts only on its own
conclusion. Four tests cover it:

```
✔ a FORGED verdict cannot cause an action
✔ a verdict replayed against a newer rule pack is refused
✔ a verdict about a stale view of the issue is refused
✔ the executor refuses an action capped at hold even if a verdict says auto
```

---

## 2. Multi-tenancy is not a field on a record

A project **is** a rule pack. Onboarding a team is authoring one; it is not changing code.

Two packs ship, with deliberately different postures, and they decide the same incident
differently:

| | northwind-msp | acme-retail |
|---|---|---|
| unattended action | on | **off** |
| confidence floor | 0.75 | 0.90 |
| duplicate window | 60 min | 120 min |
| always a human | Highest | Highest, High |

```
✔ the same incident is decided differently by two rule packs
✔ a project with a higher confidence floor holds what a lower one allows
```

Load either from the project settings page to see it, with no code change.

**The default for a new project is `unattendedAllowed: false`.** Installing Gatekeeper changes
nothing about what happens to your incident queue until somebody deliberately turns it on. A
stored rule pack that fails validation is **not** silently replaced with the default either —
that would quietly change what the robot may do, and nobody would know which way.

---

## 3. Sponsor technology, in detail

| What | Where | Note |
|---|---|---|
| Forge | [`manifest.yml`](manifest.yml) | `nodejs22.x`, three scopes, nothing wider. Deployed clean, and reported **eligible for Runs on Atlassian** — no data egress outside Atlassian, which is the point for an app whose argument is about trust |
| `rovo:agent` ×2 | `gatekeeper-agent`, `gatekeeper-reviewer` | separate prompts; the proposer is **not** wired to `review-proposal`, so it cannot clear its own R07 |
| `action` ×6 | [`src/index.js`](src/index.js) | `triage-incident` and `review-proposal` are `CREATE`; the three read-only ones are `GET` |
| `rovo:mcp` | `gatekeeper-mcp` | exposes **only** the three `GET` actions. An outside agent may inspect this project's policy; it can never act through it. There is a test that fails if a writing action is ever added. |
| `jira:issuePanel` | [`console.jsx`](src/frontend/console.jsx) | UI Kit, `render: native` |
| `jira:projectSettingsPage` | [`settings.jsx`](src/frontend/settings.jsx) | the rule pack editor |
| Forge storage | [`src/platform/store.js`](src/platform/store.js) | rule packs, verdicts, receipts |
| Jira REST v3 | [`src/platform/jira.js`](src/platform/jira.js) | the only module that talks to Jira, and the only five effects that exist |

The agent prompts are worth reading as design artefacts rather than configuration:
[`agent.md`](src/agent/prompts/agent.md) tells the proposer it has no authority and asks it not
to offer to bypass the gate; [`reviewer.md`](src/agent/prompts/reviewer.md) tells the reviewer
that confirming everything is worse than not reviewing at all.

---

## 4. Tests

```bash
npm test      # 119 tests, no Forge runtime, no network, no credentials
```

| File | Tests | Covers |
|---|---:|---|
| `tests/evidence.test.js` | 22 | canonical digests, correlation precedence, quote verification |
| `tests/gate.test.js` | 26 | all eleven rules, precedence, determinism, malformed model output |
| `tests/receipts.test.js` | 15 | the chain, and four distinct ways of tampering with it |
| `tests/executor.test.js` | 14 | forged, stale and replayed verdicts; human override |
| `tests/pipeline.test.js` | 24 | the two-agent handoff end to end, with Jira faked at the seam |
| `tests/manifest.test.js` | 18 | the manifest cross-referenced against the code |

`tests/manifest.test.js` exists because `forge lint` needs an Atlassian login and so cannot run
on a fresh clone. It catches the class of mistake lint would not catch anyway — a
`handler: index.triageIncidnet` that is valid YAML, passes lint, deploys, and breaks the first
time a judge uses it.

Note the test invocation is `node --test tests/*.test.js`, not `node --test tests/`. The second
form silently runs **zero** tests on some Node versions.

---

## 5. Presentation

See [`VIDEO.md`](VIDEO.md) for the beat sheet and [`DEMO-RUNBOOK.md`](DEMO-RUNBOOK.md) for the
rehearsal script. The centrepiece is the fabricated-citation hold: the reviewer says "confirm"
and offers a quote to justify it, R08 finds the quote is not in the evidence, and the action is
held for a human — on screen, with the receipt.

---

## Run it

```bash
npm install
npm test
```

**The site must have Rovo.** A free Atlassian developer site does not have it — Rovo is
Standard, Premium and Enterprise only — so the two agents will simply not appear, however
cleanly the app installs. Use a Forge demo site (`forge site provision`), which ships
enterprise Jira, Confluence, JSM and Rovo.

To deploy it you need a Rovo-enabled site and the Forge CLI:

```bash
npm install -g @forge/cli
```

```bash
forge login
```

```bash
forge register && forge deploy && forge install
```

`forge register` writes the real `app.id` into `manifest.yml`, replacing the placeholder.

## For AI agents

Start with [`AGENTS.md`](AGENTS.md).

| Need | Where |
|---|---|
| Contracts and shared types | [`src/shared/contracts.js`](src/shared/contracts.js) — frozen |
| The eleven rules | [`src/gate/gate.js`](src/gate/gate.js) |
| Quote verification | [`src/gate/evidence.js`](src/gate/evidence.js) |
| The only code that writes to Jira | [`src/platform/jira.js`](src/platform/jira.js) |
| Forge entry point (wiring only) | [`src/index.js`](src/index.js) |

---

## Honest limits

Named here before a judge finds them. See [`docs/LIMITS.md`](docs/LIMITS.md) for the full list.

- **Deployed, but the Jira integration is still unverified.** The app is deployed to its
  development environment with `forge lint` reporting no issues, which rules out a class of
  structural problem. It rules out nothing about Jira: not one request in
  `src/platform/jira.js` has ever executed, and no Rovo conversation has happened. Every one of
  the 119 tests runs against fakes at the Jira seam. Experience says the first live run finds
  things no local test can.
- **Forge storage has no compare-and-swap.** Two concurrent appends to one issue's receipt
  chain could collide and produce a duplicate sequence number. `verifyChain` detects the damage;
  it cannot prevent it.
- **The confidence floor is a floor on a self-reported number.** It catches a model that admits
  uncertainty and does nothing about one that is confidently wrong. R07 and R08 are what cover
  that case, which is why the floor is not the safety story on its own.
- **The reviewer is a separate agent, not an independent one.** It has a different prompt, a
  different module key, and is not wired to the proposing action — so it cannot clear its own
  R07. It is still the same underlying model, and a shared blind spot would defeat both.
- **No measured noise-reduction figure yet.** The correlation logic is tested for correctness on
  constructed cases. A percentage would need a real queue, and inventing one would be exactly
  the kind of unfalsifiable claim this project argues against.
