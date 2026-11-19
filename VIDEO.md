# Demo video — Codegeist 2026

Two of the five judging criteria (Presentation, and most of Design) are scored off this video
rather than the code. It gets its own build time.

**Cap: 5:00** — Codegeist's rules say "should be less than five (5) minutes. Judges are not
required to watch beyond five minutes." **Target 4:30.**

## Rules check

- [ ] Under 5:00 (target 4:30)
- [ ] Uploaded and **public** on YouTube — unlisted fails the rule as written
- [ ] Link in the README **and** on the Devpost submission form
- [ ] Shows the app actually functioning in a real Jira site
- [ ] No copyrighted music, no third-party trademarks beyond Atlassian's own product UI
- [ ] English

## The spine

The centrepiece is **the fabricated citation**. Everything before it sets up why that moment
matters; everything after it is consequence. Do not open with the architecture — open with the
thing nobody else can show.

## The script

| Time | Say (verbatim) | Show on screen |
|---|---|---|
| 0:00–0:20 | "Here is a Jira Service Management ticket, and here is an AI agent that has decided what to do about it. The agent is confident. It has even quoted the evidence that justifies its decision. That quote does not exist. It made it up — and I am going to show you that happening, live, in about ninety seconds." | the issue, Gatekeeper panel collapsed |
| 0:20–0:40 | "This is Gatekeeper. It is a Forge app for incident triage, built on one rule: the model proposes, deterministic code decides, and nothing executes without a receipt. The agents here are load-bearing and completely untrusted." | the panel, the three trust levels |
| 0:40–1:10 | "First, before any model is asked anything: correlation. Deterministic, no AI. This alert is the fourth copy of the same signature in forty minutes, so it closes — and it writes down *why* it closed. That is where most of the volume goes, for free." | triage a duplicate, show the suppressed receipt |
| 1:10–1:50 | "Now a real one. I ask the Gatekeeper agent to triage it. It gathers evidence, proposes an action — and notice it can only choose from this list, which an administrator wrote. Then the gate runs: eleven rules. It is held. R07: nothing on this issue has been reviewed yet." | the Rovo conversation, then the panel showing R07 fired |
| 1:50–2:40 | "So a second agent reviews it. Different prompt, different module, and deliberately not told how confident the first one was. It comes back 'confirm' — and it offers this quote to justify it. Watch rule R08. The quote is checked against the source evidence. It is not there. The reviewer fabricated its citation, and the action is held for a human." | the reviewer's confirm, then R08 fired with the unverified quote shown |
| 2:40–3:05 | "That check only looks at source evidence. The reviewer can see the diagnosis it is reviewing — it has to — so if we matched against everything, it could 'corroborate' a diagnosis by quoting that diagnosis back at itself. That is not corroboration, so agent output is excluded." | `verifyQuotes` in the editor, the `.filter(i => i.source)` line |
| 3:05–3:35 | "Here is the honest version: the reviewer confirms, cites a line that *is* in the evidence, all eleven rules pass, and it runs. One action, one receipt, signed and chained to the one before it. Edit any earlier receipt and this verification fails." | the auto path executing, the chain verifying |
| 3:35–4:00 | "The executor does not trust the verdict it was handed. It re-derives it. So if I tighten the rules and replay the old approval — refused. A forged verdict cannot cause an action." | toggle unattended off in settings, replay, show the refusal |
| 4:00–4:20 | "A project *is* a rule pack. Onboarding a team is authoring one of these, not changing code. Same incident, second tenant, different answer — no code changed." | load acme-retail, re-run, different verdict |
| 4:20–4:40 | "What is not done: this has one honest gap. Every number I have is from 118 local tests. I have no measured noise-reduction percentage, because producing one honestly needs a real queue with real labels, and I would rather tell you that than show you a figure I made up." | docs/LIMITS.md on screen |
| 4:40–4:55 | "Install link and repo are on the submission. Built on Forge, two Rovo agents, and a policy gate the model cannot talk its way past." | install link + repo URL |

## Recording rules that save the take

- **Record the demo path first**, while the dev site is seeded and working. Narrate afterwards.
- Reset between takes. A second run with a receipt chain already three deep tells a different
  story than the one you are narrating.
- Hide notifications, bookmarks, other tabs, and your email. Full screen, 1080p.
- Zoom the Jira UI to ~125%. Judges watch on laptops.
- Never narrate a spinner. If a Rovo response is slow, cut.
- Three takes. The third is the good one.
- The fabricated-citation beat is the whole video. If one beat is perfect, make it that one.

## Fallback

If live capture keeps breaking, record the happy path once and narrate over it. The rule asks
for footage of the app functioning, not for a live stream. A smooth recorded run beats a
stuttering live one.
