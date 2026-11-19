# Honest limits

What does not work, what is unverified, and where this would break. Written down
because a judge who finds a weakness you did not name stops believing the rest,
and because the thesis of this project is that unfalsifiable safety claims are
worthless.

Last updated 19 Nov 2026.

## Not verified against a live Atlassian site

**This is the big one.** All 118 tests run against fakes at the Jira seam. What has
actually been verified:

| | Status |
|---|---|
| The gate, executor, receipt chain, correlation, quote verification | tested, 118 tests, no network |
| `manifest.yml` structure, resource files, YAML validity | verified by the real `forge lint` |
| Manifest cross-references against the code | verified by `tests/manifest.test.js` |
| Jira REST calls in `src/platform/jira.js` | **never executed** |
| A real Rovo conversation invoking the actions | **never happened** |
| `forge deploy` / `forge install` | **never run** |

Full `forge lint`, deploy and install all need an Atlassian login. Until that has
happened, treat the Jira integration as unverified.

Prior experience on an equivalent project is the reason this is stated so
bluntly: a build with 75 passing tests and a "fully implemented" cloud path had
five defects found within an hour of the first real call, none of which any local
test could have caught — a request signer encoding a path wrongly, credentials
captured once and expiring mid-run, a CLI flag silently ignored, an impossible
published ratio, and a test runner silently running zero tests. The lesson was
that local tests validate the code against your *model* of the service, and only
a real call validates the model.

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
- "118 tests" — a count, not a coverage figure. The front end has no tests at
  all; it is deliberately logic-free, but "deliberately logic-free" is an
  assertion about code nobody has tested.
