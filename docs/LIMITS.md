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
