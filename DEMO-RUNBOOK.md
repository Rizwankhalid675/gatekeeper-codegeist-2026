# Demo runbook — Gatekeeper, Codegeist 2026

Codegeist is judged asynchronously: judges install the app in their own Jira site and
click around. So this runbook has two jobs — the 90-second version for a live
conversation, and **the judge-install path**, which is the one that actually
decides the score. A judge who cannot get it configured scores it as broken.

## The 90-second beat sheet

Opens on the fabricated citation, never on the architecture. The last two beats
volunteer one honest limitation, then end on the install link and the repo.

| # | Say | Do | They should see | If it breaks |
|---|---|---|---|---|
| 0 | "An agent decided what to do about this ticket, and quoted the evidence that justified it. The quote doesn't exist." | Open the issue with the fabricated-citation run already on it | R08 fired, the invented quote shown verbatim | Screenshot in `docs/img/r08-hold.png` |
| 1 | "The model proposes. Deterministic code decides. Nothing executes without a receipt." | Scroll the panel to the eleven rules | All eleven, fired and passed | — |
| 2 | "Before any model is asked: correlation. This is the fourth copy in forty minutes, so it closes — and says why." | Triage `NW-102`, the duplicate | `suppressed: duplicate`, with related keys | Pre-seeded receipt already on `NW-102` |
| 3 | "Two agents. The reviewer has a different prompt and is not told the proposer's confidence. It can't clear its own review." | Show the Rovo conversation, both agents | R07 holding the unreviewed proposal | `npm test -- pipeline` output |
| 4 | "Honest version: real citation, all eleven pass, it runs. One receipt, chained." | Triage `NW-101`, review it honestly | `auto`, chain verified | Fall back to the recorded take |
| 5 | "What's missing: I have no measured noise-reduction number, because an honest one needs a real queue. Install link and repo are on the submission." | Open `docs/LIMITS.md` | The limits section | — |

## The judge-install path — rehearse this on a clean site

This is the part the rules are explicit about: *"Detailed instructions must be
provided for all configuration steps that must be taken."* Rehearse it on a Jira
site that has never seen the app.

### READ THIS FIRST: the site must have Rovo

**Gatekeeper's two agents do not appear on a free Atlassian developer site.**
Rovo is listed for Standard, Premium and Enterprise only, and developers hit
exactly this during Codegeist 2026: the Forge app installs cleanly, and Rovo is
simply absent — no button, no chat, no agents list. A judge who installs onto a
free site will see a panel that works and two agents that do not exist, and will
score it as broken.

The fix, confirmed by developers in that thread and by this build, is a **Forge
demo site** (`forge site provision`), which ships enterprise Jira, Confluence,
JSM *and* Rovo. One per developer, active 90 days. A Premium trial is reported
as unreliable for this — at least one had Rovo disabled.

**So the submission instructions must tell judges to install onto a demo site or
a Rovo-enabled site, in the first line, before anything else.** This is the
single most likely way to lose the submission to a configuration problem rather
than a code problem.

Our own site: `one-atlas-vwgf.atlassian.net`, expires **2027-02-17** — after the
22 Dec deadline and after judging ends on 3 Feb, but only two weeks after. If
anything needs re-demoing in February, check it is still alive.

1. `forge install --site <judge-site> --product jira`
2. Open any Jira Service Management issue → the **Gatekeeper** panel appears in
   the right-hand panel list.
3. **Project settings → Gatekeeper rules** → click **Load northwind-msp**. Without
   this, every project defaults to `unattendedAllowed: false` and nothing will
   ever auto-execute — which is correct behaviour and a confusing first demo.
4. In Rovo, ask **Gatekeeper**: `Triage NW-101 and show me the verdict`.
5. In Rovo, ask **Gatekeeper Reviewer**: `Review the proposal on NW-101`.
6. Re-open the issue panel to see the verdict, the handoff and the receipt chain.

- [ ] Rehearsed on a site that has never had the app installed
- [ ] Seed issues created and their keys written into the submission instructions
- [ ] The two demo rule packs load from the settings page without an error
- [ ] Every step above tried by someone who did not write the app, if possible

## Before you present

- [ ] Rehearsed 3× with a fresh seed between each
- [ ] Browser tabs pre-opened in order, Jira zoom ~125%, notifications off
- [ ] Recorded fallback ready in case Rovo is slow or the site is down
- [ ] Nothing personal visible — Jira sites show your name and email everywhere

## Known failure modes and the fix

| Symptom | Cause | Fix mid-demo |
|---|---|---|
| Panel shows "Gatekeeper could not load" | the Jira REST shape differs from what `src/platform/jira.js` expects — the most likely first-contact failure | read the error text, it carries Jira's own complaint; fall back to the recording |
| Everything is held, nothing ever runs | the project is on the default pack, `unattendedAllowed: false` | settings page → Load northwind-msp |
| Every verdict is `reject` on R03 | the evidence digest is moving between calls, probably ADF parsing | the panel shows the digest; compare two loads |
| Rovo invents an action id | it did not call `describe-rulepack` first | that is R01 working; show the rejection and move on, it demos well |
| Rovo response times out | model latency | cut, or switch to the panel which reads stored state only |
| Transition fails | the allow-listed transition name is not in this site's workflow | the error lists the available names; use `comment-triage-summary` instead |

## The three questions they will ask

1. **"How do you know the model didn't make that up?"** → We don't trust it not
   to. Every quote an agent offers is checked against source evidence by
   deterministic code — and only *source* evidence, so one agent cannot
   corroborate another by quoting it. A fabricated citation holds the action.
   That is rule R08, and it is in the video.
2. **"What happens when it fails?"** → Three ways. A malformed response is
   refused before the gate and nothing is stored. A proposal the gate dislikes is
   held with the proposal preserved for a human and the rules named. An
   authorised action that then fails in Jira writes a `failed` receipt before the
   error surfaces — so an attempt never goes unrecorded.
3. **"What's real here vs mocked?"** → The gate, executor, correlation, quote
   verification and receipt chain are real and have 118 tests. The Rovo agents
   are real. As of the last update to `docs/LIMITS.md`, the Jira REST layer had
   never been exercised against a live site — check that file for the current
   answer rather than taking this sentence as today's truth.
