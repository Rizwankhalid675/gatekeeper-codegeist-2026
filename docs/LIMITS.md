# Honest limits

What does not work, what is unverified, and where this would break. Written down
because a judge who finds a weakness you did not name stops believing the rest,
and because the thesis of this project is that unfalsifiable safety claims are
worthless.

Last updated 19 Nov 2026, after the first successful deploy.

## Not verified against a live Atlassian site

**This is the big one.** All 119 tests run against fakes at the Jira seam. What has
actually been verified:

| | Status |
|---|---|
| The gate, executor, receipt chain, correlation, quote verification | tested, 119 tests, no network |
| `manifest.yml` structure, resource files, YAML validity | verified by the real `forge lint` — **no issues found** |
| Manifest cross-references against the code | verified by `tests/manifest.test.js` |
| `forge deploy` | **done** — v2.1.0 on the development environment, lint clean |
| Jira REST calls in `src/platform/jira.js` | **never executed** |
| A real Rovo conversation invoking the actions | **never happened** |
| `forge install` into a site | **not yet run** |

The app now deploys with a clean lint, which rules out a whole class of
structural problem. It rules out nothing about the Jira integration: deploying
means the code was accepted, not that a single request to Jira has ever been
made. Treat `src/platform/jira.js` as unverified until an issue has actually
been triaged in a real site.

Two manifest errors only the real linter found, recorded because neither is in
the documentation: strings are capped at **255 characters**, and when one
exceeds it the schema's `oneOf` *also* reports `action required properties are
'function, description, actionVerb, key'` — which is a red herring pointing at a
field that is perfectly fine. `tests/manifest.test.js` now guards the limit.

Prior experience on an equivalent project is the reason this is stated so
bluntly: a build with 75 passing tests and a "fully implemented" cloud path had
five defects found within an hour of the first real call, none of which any local
test could have caught — a request signer encoding a path wrongly, credentials
captured once and expiring mid-run, a CLI flag silently ignored, an impossible
published ratio, and a test runner silently running zero tests. The lesson was
that local tests validate the code against your *model* of the service, and only
a real call validates the model.

### What the first live run actually settled (19 Nov 2026)

Installed on `one-atlas-vwgf.atlassian.net`, triaged CLSD-1 through the Rovo
agent end to end. Of the four risks predicted below:

| Risk | Outcome |
|---|---|
| ADF parsing shifting the evidence digest | **held up** — digest computed, `1aa79f08c8cf`, stable across reloads |
| The JQL search endpoint | **held up** — correlation reported "paged, seen 1× in the window" |
| Workflow transition names | **still untested** — no transition has been attempted |
| App-comment author identity | **was broken, now fixed** — see below |

Two defects found that no local test could have caught:

1. **Every resolver call failed in the deployed bundle.** `@forge/resolver` is
   CommonJS; `"type": "module"` in package.json made the Forge bundler resolve
   the default import to the module namespace, so `new Resolver()` threw at
   import time. The panel showed a spinner forever. All tests passed throughout.
2. **Gatekeeper's own receipt comments were being treated as source evidence.**
   The exclusion tested whether the author string started with `gatekeeper`, but
   Jira returns an **accountId** for app-authored comments, so it never matched.
   An agent could have quoted Gatekeeper's own receipt back and had it count as
   corroboration — defeating the one guard the project is built around. Now keyed
   on `accountType === 'app'`, with a regression test verified to fail against
   the old condition.

A third observation, not a defect: asked to triage CLSD-1 — a legal question
about sanctions — the agent proposed labelling it `gatekeeper-incident` at
**confidence 0.90**, justifying it as "a critical production database outage".
There is no outage; the model invented one. The gate held it under R04 and R07
regardless, which is precisely the argument: the confidence floor would not have
caught this, because the model was confident and wrong.

### Verified: the transition effect, the human override, and the failed-receipt path

Exercised live on CLSD-3. The gate held `transition-issue` under R05 (the rule
pack caps it at hold) and R07. A human then took it from the panel, and the
effect refused:

    transition "In Progress" is not available on CLSD-3 right now. Available: Start

That is the effect working: it reads the issue's real transitions, refuses a name
the workflow does not offer, and names the ones it does. The refusal surfaced in
the panel, and the chain recorded both steps:

    000000  held    gatekeeper:gate   transition-issue  Held by R05, R07...
    000001  failed  user:712020:...   transition-issue  Attempted by a human... Available: Start
    Chain verified - 2 receipts

**But the default rule pack ships transition names that match no real workflow.**
`['Triage', 'In Progress', 'Waiting for support', 'Resolved']` was a guess, and
the demo site's workflow offers `Start`. An admin currently discovers the right
names by triggering a failure. The settings page now says so; a better fix would
list the workflow's real transitions in the editor, which needs an API the gate
cannot reach from a pure function.

### All five effects exercised live (19 Nov 2026)

| Effect | Path | Result |
|---|---|---|
| `comment` | auto, after review | executed, receipt seq=000002 |
| `label` | auto, after review | executed; `gatekeeper-incident` applied to CLSD-1 |
| `link` | auto, after review | executed; CLSD-4 linked as a duplicate of CLSD-5 |
| `assign` | human override from the panel | executed; CLSD-5 assigned, receipt `7feb0280799d...` |
| `transition` | human override from the panel | both paths verified |

The transition effect was proven twice over. With a *wrong* name it read the
issue's real transitions, refused `In Progress` and named `Start`. After `Start`
was added to the permitted values in the rule pack editor, a second proposal
passed R02, was held at R05 as designed, and a human override moved CLSD-3 from
**To Do** to **In Progress**.

### RESOLVED: the rule pack's action allow-list is now editable

Each action in the editor now has its ceiling (may run unattended / always a
human), its reversibility and its permitted values as live controls. Every change
saves the whole pack through `saveRulePack`, which validates it and bumps the
version — so editing the allow-list cannot retroactively authorise a verdict the
gate already reached under the old rules. The UI says so on save:

    Saved as v3. Any verdict decided under v2 is now stale and cannot be executed.

This closed the transition gap in the same session it was found: `Start` was
added to the permitted values, and the next proposal passed R02 and transitioned
the issue.

One sharp edge is now called out in the UI rather than left implicit: **an empty
permitted-values box means ANY value**, because R02 only restricts an action that
has values. Clearing the box opens the action up rather than locking it down.

The editor still cannot add or remove actions, only configure the ones the pack
already defines.

### Known gap: only the REVIEWER's citations are verified

R08 checks `review.quotes`. The proposing agent's `quotes` are parsed, stored and
shown in the panel, but nothing verifies them. On CLSD-3 the proposer cited a
line from the chat conversation rather than from the issue evidence, and no rule
objected — because no rule looks.

This is narrower than it sounds (the proposer's quotes do not authorise anything;
the reviewer's are what R08 gates) but the README should not be read as saying
every quote is checked. Verifying the proposer's quotes too would be a small
change to `decide()` and is the obvious next hardening step.

### RESOLVED: the blank issue panel (and why the bisect mattered)

`<DynamicTable head={[...]}>` in `console.jsx` passed a bare array where UI Kit
needs `{ cells: [...] }`. DynamicTable throws, the throw escapes the reconciler,
and the **entire panel** renders blank: header present, body empty, no error on
screen, nothing in `forge logs`, nothing in the browser console (the Forge iframe
is cross-origin). `settings.jsx` had the shape right, which is why that page
never broke and misled the diagnosis.

It was invisible until there was data. The receipts table is only reached once a
receipt exists, so the panel looked healthy on every fresh issue and broke the
moment Gatekeeper did anything — the opposite of how a bug usually presents, and
the reason it was mistaken for a deploy regression.

**The bisect was what corrected it.** The first step — disabling the receipt
filter and redeploying — came back negative, which ruled out the suspected commit
and forced a re-reading of the evidence: the panel had rendered on CLSD-1 and
CLSD-2 *before* triage and failed on all three *after*. Receipt-count dependent,
not deploy dependent. A negative bisect step is worth as much as a positive one.

`tests/frontend.test.js` now statically checks both this and the unhandled
`invoke()` rejection, because there is no renderer here to catch either.

### The old entry, for the record: blank panel suspected as a v2.7.0 regression

Introduced by the receipt-exclusion fix and found immediately after deploying it.
The panel header appears; the body is empty. What is known:

- The resolver bundle is healthy — the global settings page, which uses the same
  bundle and the same resolver, renders correctly on v2.7.0.
- `forge logs` shows **no** errors since the deploy, so `getConsole` is not
  throwing. A thrown error would be caught by `guard` and rendered as a message.
- The panel's menu offers "Collapse", so Jira believes it is expanded.
- No errors in the top frame's console; the Forge iframe is cross-origin so its
  own errors are not visible there.
- It rendered correctly on v2.6.0 and broke on v2.7.0, which changed only
  `contracts.js`, `receipts.js` and `evidence.js` — none of which `console.jsx`
  imports. So the likely cause is `getConsole` returning a shape the panel's
  render cannot handle, failing silently inside the UI Kit reconciler.

Next step is to bisect: redeploy with the receipt filter removed to confirm it is
the trigger, then narrow within `getConsole`'s return value. **Do not ship while
this is open** — the panel is the product's main surface.

### The rest of the path is verified end to end (19 Nov 2026)

On `one-atlas-vwgf.atlassian.net`, through the real Rovo agents:

| Step | Result |
|---|---|
| Panel renders live evidence with a stable digest | works |
| Agent proposes via `triage-incident` | works |
| Gate holds under R04 + R07 with unattended off | works |
| Rule pack editor switches CLSD to northwind (unattended on) | works |
| Gate then holds under R07 alone, pending review | works |
| Reviewer confirms via `review-proposal` | works |
| **All eleven rules pass, action executes, receipt seq=000002** | **works** |

Still untested: the `transition` and `assign` effects. Only `comment` has
actually run against Jira; the other four effects in the executor's map have
never been exercised live, and transition names in particular are per-workflow.

### RESOLVED: the rule pack editor is now reachable

`jira:projectSettingsPage` never appears in the new JSM "Space settings"
navigation. `jira:globalPage` does appear, under Apps in the main navigation,
and the editor now lives there with a project picker (a global page has no
project in its context).

### The old entry, kept for the record: the editor was unreachable

`jira:projectSettingsPage` is documented as working in Jira Service Management,
and `forge lint` accepts it, but on a current demo site it does **not** appear in
the new JSM "Space settings" navigation — only Automation is listed under Apps.
Checked the settings nav, `/settings/apps`, the global `/jira/settings/apps`, and
the Apps menu.

This matters more than it sounds. Every project defaults to
`unattendedAllowed: false`, and the rule pack editor is the only way to change
that. If a judge cannot reach it, **nothing can ever reach `auto`**, and half the
product is invisible — they would see a system that only ever says "held".

`jira:adminPage` has been added as a second, globally reachable surface. It
deploys and lints clean, but has **not** been verified to render; the
installation upgrade that would publish the new module is still pending.

Until this is resolved, the auto-execute path, the transition effect and the full
two-agent handoff to `auto` remain untested against a live site.

Specific things most likely to be wrong on first contact:

- **ADF handling.** `plainText()` walks Atlassian Document Format by hand so the
  evidence digest is stable. Real descriptions contain panels, tables, media and
  macros this has never seen. A node type it handles differently from expected
  changes the digest, and a changed digest holds everything under R03.
- **The JQL search endpoint.** `/rest/api/3/search/jql` is used for correlation.
  If the parameter shape is wrong, correlation silently sees no recent issues —
  and "no recent issues" looks exactly like "first occurrence", so duplicates
  would pass through rather than erroring.
- **Transition names.** The rule pack allow-lists transition *names* and resolves
  them to ids at execution time. Names differ per workflow; the allow-listed set
  in the default pack is a guess at a standard JSM workflow.
- **Comment author identity.** Gatekeeper's own comments must be excluded from
  source evidence, and that currently keys on the author string starting with
  `gatekeeper`. As an app-authored comment, the real author is the app's
  accountId, so this needs checking against a live site or the exclusion silently
  stops working — which would let the reviewer corroborate itself.

## Concurrency

Forge storage has no compare-and-swap. `appendReceipt` reads the head, computes
the next sequence number, and writes — so two concurrent appends to one issue
could produce a duplicate `seq` and a forked chain. `verifyChain` detects the
damage and says where; it cannot prevent it. In practice one issue is handled by
one invocation, but that is an assumption, not a guarantee.

## The confidence floor is weaker than it looks

R06 compares a self-reported number against a threshold. It catches a model that
admits uncertainty. It does nothing whatsoever about a model that is confidently
wrong, which is the more dangerous case. R07 (adversarial review) and R08
(citation verification) are what address that, and the floor should not be read
as the safety story.

## The reviewer is separate, not independent

`gatekeeper-reviewer` has its own prompt, its own module key, and is deliberately
not wired to `triage-incident`, so the proposing agent cannot clear its own R07.
Its prompt withholds the proposer's confidence to avoid anchoring.

It is still the same underlying model. A blind spot shared by both defeats the
pair. Genuine independence would need a different model or a human, and this
design does not provide it.

## No measured noise-reduction number

Correlation is tested for correctness on constructed cases — duplicate windows,
flapping thresholds, benign signatures, maintenance windows, and the precedence
between them. There is no "suppressed 94% of alerts" figure here, because
producing one honestly needs a real queue with real ground-truth labels, and
every available alternative (synthetic traffic labelled by the same generator
that produced it; a number from a comparable project) would be measuring the
generator rather than the system.

## Scope that was deliberately left out

- **No automation-rule trigger.** Triage runs when an agent is asked. A
  `trigger` module reacting to issue creation is the obvious next step and would
  change the risk profile considerably, since nobody would be in the
  conversation.
- **Only five effects.** comment, transition, assign, link, label. No webhooks,
  no external systems, no Systems Manager equivalent. The allow-list is the
  safety property, so widening it is a code-review decision rather than
  configuration.
- **No rule pack import/export or audit log of pack changes.** The version
  number increments on save, which is enough to make an older verdict detectably
  stale, but there is no record of *who* changed what.
- **The project settings page writes the whole pack on every change.** Two
  administrators editing at once would have the last write win silently.

## Things that are true but easy to overstate

- "The gate is a pure function" — it is: no clock, no network, no storage, `now`
  is an argument. But it is only pure given its inputs, and the evidence bundle
  it receives came from Jira, where nothing is pure.
- "Nothing executes without a receipt" — accurate, and it now also covers a
  failed attempt (`RECEIPT_EVENT.FAILED`). It does not cover a Jira call that
  succeeded while the response was lost in transit; that would be recorded as
  failed when it actually happened.
- "119 tests" — a count, not a coverage figure. The front end has no tests at
  all; it is deliberately logic-free, but "deliberately logic-free" is an
  assertion about code nobody has tested.
