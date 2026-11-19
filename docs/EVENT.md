# Codegeist 2026 — submission brief

Read from <https://codegeist2026.devpost.com/rules> on **19 Nov 2026**. Everything in
quote marks is verbatim from the Official Rules. Re-read before the freeze — §11 lets
the Sponsor amend the rules at any time.

---

## 1. Eligibility — CLEARED

> "The Hackathon IS open to: Individuals who are at least the age of majority where they
> reside as of the time of entry ("Eligible Individuals")"

| Test | Our position | Verdict |
|---|---|---|
| Individual entry allowed | Yes, explicitly, with no organisation requirement | PASS |
| Age of majority | 24, California (18) | PASS |
| Residence not excluded | Sacramento, CA, USA. Excluded list is Brazil, Quebec, Russia, Belarus, Crimea, Cuba, Iran, North Korea, Syria, Sudan, Myanmar + OFAC | PASS |
| Denied/SDN lists | Not listed | PASS |
| Employee of Atlassian or Devpost, or family/household of one | No | PASS |
| Employs or is employed by a judge | No | PASS |
| Prior funding/contract/commercial licence from Atlassian or Devpost for this project | No | PASS |

**There is no partner-program gate.** This is the thing that killed the AWS MSP entry: that
event required a corporate email on an AWS Partner Network member domain. Codegeist has no
equivalent clause anywhere in the rules. The only account needed is a **free Atlassian Cloud
developer licence**, which any individual can create.

Access needed, both free and self-serve:
- Devpost account — have one
- Atlassian Cloud developer site — <https://developer.atlassian.com/cloud/>

## 2. Dates (all Pacific Time)

| | |
|---|---|
| Registration + Submission | 27 Oct 2026 09:00 → **22 Dec 2026 12:00** |
| Judging | 5 Jan → 3 Feb 2027 |
| Winners | ~15 Feb 2027 |

**33 days from 19 Nov.** The rules state no extension either way; Devpost's convention is
that late submissions are not accepted. Treat 22 Dec 09:00 PT as the real wall.

## 3. Mandatory technology

> "Entrants must build an app using Atlassian's Forge platform and integrate with at least
> one Atlassian product or platform capability (Jira, Confluence, Jira Service Management,
> Bitbucket, Teamwork Graph, Rovo)"

- Must run **on Forge**. Not a hosted web app that talks to Jira's REST API — a Forge app
  with a `manifest.yml` and at least one Forge module.
- New or existing, but: an existing project "must have been updated or rebuilt in the Forge
  platform after the start of the Hackathon Submission Period and must have a Forge manifest
  file and include at least one Forge module."
- Judges install it themselves, so it must install cleanly from a share link.

## 4. Category

Three categories, one grand-prize set each (1st $15k / 2nd $8k / 3rd $5k):

| Category | Fit |
|---|---|
| Apps for Software Teams | **chosen** — incident triage is a dev-team workflow; "issue triage that actually understands what matters" is in the category copy |
| Apps for Business Teams | no |
| Apps for Specialized Industries | possible second submission (MSP/managed-services angle) |

## 5. Bonus prizes — four separate pools, 6 winners each at $1,500

| Bonus | Requirement | Plan |
|---|---|---|
| Best Agents | Forge app including `rovo:agent`, `rovo:agentConnector`, or reusable `rovo:skill` / `rovo:action` other agents can invoke | **primary target** — the triage agent ships as a `rovo:agent` |
| Best app with Atlassian MCP | exposes tools via the Atlassian MCP server using `rovo:mcp` | **target** — expose the policy gate as an MCP tool |
| Best Teamwork Graph integration | connects data into, and/or consumes data from, the Teamwork Graph API | stretch |
| Best Marketplace published app | published to Marketplace, or submitted for listing; give the listing link or the review-ticket link | cheap — submitting for listing qualifies |

Prize stacking, verbatim:

> "The same Submission can win up to one Grand Prize and one Bonus Prize."
> "The same Entrant can submit multiple unique Submissions."

So selecting all four bonuses costs nothing, and a second genuinely different app is a second
lottery ticket. Also: **Participation Prize** (Atlassian swag) goes to the first 300 entrants
with an eligible submission — submit early, not at the wire.

## 6. Submission checklist — every item is required

- [ ] Forge app meeting the Project Requirements above
- [ ] **Installation link** for judges — `forge install --share` flow per
      <https://developer.atlassian.com/platform/forge/distribute-your-apps/#start-sharing-your-app>
- [ ] **Full configuration instructions** — "Detailed instructions must be provided for all
      configuration steps that must be taken, and any integrations that must be installed and
      configured." A judge who cannot configure it scores it as broken.
- [ ] **Demo video**, under 5 minutes, **public on YouTube**, showing the app working on its
      target device. No third-party trademarks, no unlicensed music.
- [ ] Text description of features and functionality
- [ ] An explicit write-up of **how the project meets the main technology requirement**
- [ ] Category selected + each bonus prize selected, with the write-up each bonus asks for
- [ ] English throughout
- [ ] Original work, solely owned, no IP violations

## 7. Judging — five equally weighted criteria

Stage One is pass/fail: does it fit the theme and genuinely use the required APIs.

Stage Two, each worth the same (so 20% each):

| Criterion | What the rules actually ask | How we answer it |
|---|---|---|
| Technological Implementation | "a genuine, working, non-trivial implementation when tested, not just a shallow wrapper or a single hardcoded demo path" | real Bedrock-style agent loop + deterministic gate; no hardcoded path; tests |
| Design | "a complete, coherent product experience — not just a technical proof of concept" | finished JSM panel, empty states, error states |
| Potential Impact | "a credible, specific case for solving a real problem for a real audience" | measured alert-noise numbers with provenance |
| Innovation/Idea | "does the project differ from existing concepts" | the gate: the model never holds authority, and every action leaves a signed receipt |
| Presentation | "clearly demonstrate the project working end-to-end" | scripted 5-minute video, one unbroken path |

Note the phrase "**when tested**". Judges install and run it. The demo video does not
substitute for the app working in their own test site.

## 8. The project

**Working title: Gatekeeper** — agentic incident triage for Jira Service Management where the
model proposes, deterministic code decides, and nothing executes without a receipt.

- A `rovo:agent` triages incoming JSM tickets: classifies, correlates duplicates, proposes a
  remediation drawn only from an allow-list the admin authored.
- A deterministic policy gate (plain TypeScript, no model) decides reject / hold / auto.
  It re-derives permission from the rule pack and ignores the verdict it was handed.
- Every decision writes a sha256 receipt chain into the issue — what the agent saw, what it
  proposed, which rule allowed or blocked it, and who acted.
- An adversarial reviewer agent must cite **source** evidence; a fabricated quote is detected
  and downgrades the verdict to a hold.

Carried over from the NightShift build (same author, new codebase on Forge): the architecture,
the twelve-rule gate design, the quote-verification idea, and the honest-limits discipline.
Nothing is copied — Forge is a different runtime and the rules require the Forge rebuild.

## 9. Enrol

1. Open <https://codegeist2026.devpost.com/>
2. Click **Join Hackathon** (this is where you accept the Official Rules)
3. Create the free Atlassian Cloud developer site at <https://developer.atlassian.com/cloud/>
4. `npm install -g @forge/cli`, then `forge login` — it wants your Atlassian email and a
   **Forge CLI scoped token** from <https://go.atlassian.com/forge-cli-api-token>
5. **Create a Developer Space.** Not in the rules, and not in Atlassian's getting-started
   page either — `forge register` simply refuses without one: *"You are not currently a
   member of a Developer Space. You must be a member of a Developer Space to register an
   app."* It prompts for a name on first `forge register`. This is a persistent entity in
   your Atlassian account and brings you under the Atlassian developer terms, so it is a
   decision, not a formality. Background:
   <https://developer.atlassian.com/platform/forge/developer-space/developer-spaces-introduction>
6. `forge register` → `forge deploy` → `forge install`. Register writes the real `app.id`
   over the placeholder in `manifest.yml`, so there is a manifest change to commit afterwards.
7. Build. Submit well before 22 Dec 12:00 PT — the first 300 eligible submissions get the
   participation prize, and a wire-time submission risks the queue.

**Node version:** the Forge CLI supports 22.x or 24.x and warns on anything else. This machine
has 26.13.0, which has worked for `login`, `settings` and `lint` so far. If `deploy` misbehaves,
suspect this first and `brew install node@22`.
