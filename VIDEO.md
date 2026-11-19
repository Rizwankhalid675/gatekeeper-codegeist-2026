# Demo video — Codegeist 2026

Two of the five judging criteria (Presentation, and much of Design) are scored off
this video rather than the code. It gets its own build time.

**Cap: 5:00** — the rules say "should be less than five (5) minutes. Judges are not
required to watch beyond five minutes." **Target 4:30.**

> **Rewritten 19 Nov after the app ran live.** The first draft was built around the
> fabricated-citation beat, which was a hypothesis. The live runs produced something
> better and entirely unscripted — see below. Every beat here is a thing that
> actually happened on `one-atlas-vwgf.atlassian.net`, not a thing we hope will.

## Re-shoot the beat frames before recording

`docs/img/beats/02-*` and `04-*` were captured against the **eleven**-rule gate
and show "11 of 11". The gate now has twelve rules and the panel derives the
count, so those frames contradict the current build. Re-capture them in the take.

## A stronger opener than the one below (19 Nov, after R12 landed)

CLSD-2 reads, in full: summary "Issue xyz", description "issue with this thing".
The proposer cited:

> "Critical failure in production database connection pool."
> "Configuration mismatch following recent deployment."

Neither sentence exists. Under the old gate that proposal passed every rule,
reached `auto`, and **executed** — the receipt is still on the issue. Under R12
it is held, and the rule says why: `1 of 1 citation(s) are not in the source
evidence`.

That is a better 0:00 than the CLSD-1 beat below, because the before and after
are both real and both on the record: the same issue, the same app, one rule
apart. Say it in one sentence — "this already happened; here is the rule that
would have stopped it" — then cut to the held verdict.
`docs/img/beats/05-r12-holds-fabricated-citation.jpg` is the frame.

## The spine: the model was confident and wrong, and it didn't matter

Asked to triage **CLSD-1** — a legal question about export sanctions, reading
"we have questions on sanctions and need legal support" — the agent proposed
labelling it `gatekeeper-incident` at **confidence 0.90**, justifying it as:

> "a critical production database outage requiring immediate attention"

There is no outage. There is no database. The model invented one, twice, on two
different issues, at high confidence.

**The gate held it anyway.** Not because the model was uncertain — it wasn't —
but because R04 and R07 don't care how sure it is.

That is the whole argument in one screen, and it is stronger than the planned
fabricated-quote beat because nobody set it up. Open with it.

## The script

| Time | Say (verbatim) | Show on screen |
|---|---|---|
| 0:00–0:25 | "This is a legal ticket. It says: we have questions on sanctions and need legal support. Here is an AI agent triaging it. It has decided this is a critical production database outage requiring immediate attention, and it is ninety percent confident. There is no outage. There is no database. It made that up." | CLSD-1, then the Rovo card: `confidence 0.90`, the invented rationale |
| 0:25–0:45 | "Nothing happened. Not because the model hedged — it didn't — but because in Gatekeeper the model doesn't decide. Eleven deterministic rules do, and two of them refused." | the verdict: `Held by R04, R07` |
| 0:45–1:05 | "This is Gatekeeper, a Forge app for incident triage. The model proposes. Deterministic code decides. Nothing executes without a receipt." | the panel, three trust levels |
| 1:05–1:35 | "Before any model is asked anything, correlation runs. It's deterministic. Duplicates, flapping, maintenance windows, known-benign signatures — closed with a written reason. No tokens spent." | the evidence section, `paged`, signature, digest |
| 1:35–2:10 | "When a model is involved, this is what it may do." Open the rule pack editor. "Five actions, written by an administrator. An action id that isn't on this list is refused by rule R01 before anything happens. And each one has a ceiling: this one may run unattended, this one is always a human." | the editor, the per-action toggles |
| 2:10–2:45 | "Watch the ceiling work. I ask it to move an issue through the workflow. All the other rules pass — but R05 says this action is capped at hold, so it's held for a person. A confirming review wouldn't lift it. That's the knob a team actually turns." | CLSD-3 held under R05, nine rules green |
| 2:45–3:20 | "Two agents, not one. The reviewer has a different prompt and is never told how confident the proposer was. Nothing runs unattended until a review is on the record — that's R07, and it fires on a *missing* review, not just a disagreement. Here it confirms, all twelve rules pass, and the action runs." | the reviewer, then `auto`, the executed action |
| 3:20–3:50 | "Every decision leaves a receipt, chained by sha256. Held by the robot. Attempted by a human. Failed, with the reason. Edit any earlier entry and this verification fails." | the receipt chain on CLSD-3, `Chain verified` |
| 3:50–4:10 | "And a project *is* a rule pack. Same incident, different posture, no code change." | toggle unattended off, re-run, different verdict |
| 4:10–4:35 | "What I won't claim: the traffic here is a demo site, there's no measured noise-reduction number because an honest one needs a real queue, and rule R08 checks the reviewer's citations — not the proposer's. All of that is in the limits doc, written before you asked." | `docs/LIMITS.md` on screen |
| 4:35–4:50 | "Install link and repo are on the submission. Built on Forge, two Rovo agents, and a gate the model cannot talk its way past." | install link + repo |

## Footage checklist

Capture **tab-scoped only** — never a full desktop. Each of these is a separate clip:

- [ ] CLSD-1 Rovo card showing `confidence 0.90` and the invented outage rationale
- [ ] The verdict `Held by R04, R07`
- [ ] The panel: evidence, digest, twelve rules
- [ ] The rule pack editor with the per-action ceilings
- [ ] CLSD-3 held under R05 with nine rules passing
- [ ] The reviewer confirming, then `auto` + executed
- [ ] The receipt chain with `held` / `failed` rows and `Chain verified`
- [ ] Unattended toggled off, same incident, different verdict
- [ ] `docs/LIMITS.md`

## Recording rules that save the take

- **Use fresh issues.** CLSD-1 to CLSD-5 all carry receipts and labels from testing now;
  a clean take needs issues Gatekeeper has not touched, or the panel tells a story the
  narration doesn't match.
- Hide notifications, other tabs, bookmarks and your email. The Jira site shows your
  name and address in several places — check every frame.
- Zoom to ~125%. Judges watch on laptops.
- Never narrate a spinner. Rovo takes 20–40 seconds to answer; cut every one of those.
- Three takes. The third is the good one.
- If one beat is perfect, make it the 0:00–0:25 opener.

## GIF capture was tried and measured. It is not usable footage.

Recorded the rule pack toggle through the browser extension's GIF recorder, with
every overlay disabled (the default export adds a Claude watermark, which is a
third-party trademark the rules bar without permission).

Result, measured with ffprobe rather than judged by eye:

    nb_frames=6   duration=7.400000   ->  0.81 fps
    1568x740, 1.1 MB

That is a slideshow of state changes, not a recording. It captures one frame per
tool action, so it shows the before and after of a click and nothing in between.
The recorder also caps at 50 frames, which at a merely tolerable 12 fps is about
four seconds of footage for a five-minute video.

The stills in `docs/img/beats/` are better than any frame of it, and they came
from the same mechanism.

**Use macOS screen recording.** It is the only route here that produces real
footage, and it lets the narration be recorded live against the picture instead
of timed to it afterwards. `docs/img/beats/rulepack-toggle.gif` is kept only as
the evidence behind this conclusion.

## What is still needed from a human

- **Narration.** Either record it, or generate it (the NightShift project has
  `scripts/make-narration.sh` for ElevenLabs, which reads the key from `.env` and
  never puts it on the command line).
- **A YouTube upload, public.** Unlisted fails the rule as written.
- The link then goes in the README *and* on the Devpost submission form.
