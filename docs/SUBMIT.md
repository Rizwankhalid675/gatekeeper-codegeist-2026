# Submitting Gatekeeper to Codegeist 2026

Everything that is left, in the order to do it. Deadline **22 Dec 09:00 PT**.

Two things need you specifically: the YouTube upload, and a short form in the
Atlassian developer console that asks for contact details I should not invent.
Everything else is done and committed.

---

## Before anything: a trap in the bonus prizes

`docs/EVENT.md` lists **Best Marketplace published app** as "cheap — submitting
for listing qualifies". **Do not do it.** The distribution page says, verbatim:

> once your app has a license in the app manifest, or has been submitted for
> listing on Marketplace, it can't be shared via installation link

The installation link is a **required** submission item. Submitting for
Marketplace listing would destroy it and make the app uninstallable by judges —
the exact failure that sank the AWS entry. Chase the other three bonuses:

| Bonus | Status |
|---|---|
| Best Agents | ready — `rovo:agent` (manifest.yml:8), two agents with separated duties |
| Best app with Atlassian MCP | ready — `rovo:mcp` (manifest.yml:191) |
| Best Teamwork Graph integration | not built; skip or say so |
| Best Marketplace published app | **do not enter** — it breaks the install link |

---

## 1. Upload the video to YouTube — **Public**, not Unlisted

File: `video/gatekeeper-demo.mp4` (4:38, 1080p). Unlisted fails the rule as
written.

**Title**

    Gatekeeper — the AI agent proposed an outage that didn't exist. The gate caught it.

**Description**

    Gatekeeper is an Atlassian Forge app for incident triage in Jira Service
    Management, built on one rule: the model proposes, deterministic code decides,
    and nothing executes without a receipt.

    This video opens with something that actually happened on a live site. Asked to
    triage an issue whose entire description reads "issue with this thing", the
    agent reported a critical failure in the production database connection pool.
    No outage. No database. It invented both, at 0.90 confidence — and the
    eleven-rule gate passed it and executed the action. Receipt 000002 is still on
    the issue.

    So the gate got a twelfth rule. R12 re-verifies the proposing agent's citations
    against the source evidence, deterministically, after the model has finished.
    The same issue re-run is held, and the rule says exactly why.

    What's in it:
    - Two Rovo agents with separated duties; the reviewer never sees the proposer's confidence
    - A twelve-rule policy gate that is a pure function — reject beats hold beats auto
    - An executor that re-derives its own authorisation and ignores the verdict handed to it
    - A sha256 receipt chain on every incident, and on every change to the rules themselves
    - Honest limits, written down before anyone asked

    Every screenshot is the app running on a real Jira site. This is a cut of
    stills with narration rather than a screen recording, and the repo says so.

    Built on Atlassian Forge with rovo:agent and rovo:mcp.
    Codegeist 2026 — Apps for Software Teams.

    Chapters:
    0:00 Gatekeeper
    0:15 The incident
    0:29 What the agents saw
    0:49 The fabrication
    1:04 The audit trail
    1:22 Rule R12
    1:34 The same issue, re-run
    1:47 Every rule, every time
    2:04 Three trust levels
    2:26 A project is a rule pack
    2:43 Ceilings
    3:01 The allow-list
    3:17 Who changed the rules
    3:36 Two administrators
    3:53 Honest limits
    4:14 The build
    4:30 Close

**Settings**

- Visibility: **Public**
- Subtitles: upload `video/gatekeeper-demo.srt` (English)
- "Altered content" / synthetic media: the narration is a synthesised voice, so
  tick the AI-content disclosure if YouTube asks. It costs nothing and a false
  "no" is the kind of thing that gets a video pulled.
- No music, so no copyright claim to worry about.

---

## 2. ~~Turn on the installation link~~ — DONE

Sharing is on, Jira is ticked, and the link is live and in the README. The
console says "Congratulations, you are ready to share". Nothing left here.

*(Kept below as the record of what was set and why.)*

## 2b. What was set on the distribution page

The app is **already deployed to production** (done 19 Nov, v2.0.0) — that was
the prerequisite. What is left is a form only you can fill.

Go to
<https://developer.atlassian.com/console/myapps/56faff4b-563a-4ab7-afcc-b0faba765e7d/manage/distribution>

**Most of this is already filled in** — the form is open in the browser with
three of its four required fields set:

| Field | Value | Why |
|---|---|---|
| Distribution status | **Sharing with anyone** | "within organization" would exclude the judges |
| Company/Department | Webrizz Dev | the console organisation name |
| Customer support contact | <https://webrizz.dev/contact/> | real page, checked (HTTP 200), and keeps your email off a public install page |
| Does your app store personal data? | **Yes** | it does — see below. It was defaulted to No, which was wrong |
| Terms of service | left blank | optional |
| **Privacy policy** | **still needed** | required, and must be a real URL |

**Why the personal data answer is Yes.** The receipt chain records
`user:<accountId>` whenever a person approves a held action or edits a rule
pack, and it is append-only, so those ids persist for the life of the
installation. The console's own wording — "if you copy and store personal data
associated with user references (e.g. AccountID) ... or if you cache data for
longer than 24 hours" — describes exactly what the app does. Declaring No would
have been false on a page shown to everyone who installs it.

**The privacy policy URL is the one thing left, and the repo is where it goes.**

Decided this way because a public GitHub repo solves three required things at
once — the privacy URL, judges being able to read the code, and Devpost's
repository field. Hosting the policy on webrizz.dev would solve only the first
and leave the code unreachable.

The repo is ready to publish: 91 tracked files, no `node_modules`, no `.env`,
and the accountIds in the three screenshots that showed them are masked
(`scripts/mask-accountids.py`). The largest file is the 9 MB demo video.

**Two commands — they need your GitHub login, so they are yours to run.** The
`gh` token in the keyring has expired:

```bash
gh auth refresh -h github.com
```

```bash
cd ~/Desktop/PW/hackathons/codegeist-2026 && gh repo create gatekeeper-codegeist-2026 --public --source=. --remote=origin --push
```

The privacy policy URL is then:

    https://github.com/Rizwankhalid675/gatekeeper-codegeist-2026/blob/main/PRIVACY.md

Two things to know before you run it, neither a blocker:

- Your commit email (`rizwan.khalid675@gmail.com`) is in the git history of all
  33 commits and becomes public with them. That is normal for GitHub and it is
  your own account, but it is the kind of thing worth choosing rather than
  discovering. GitHub's *Settings → Emails → Keep my email address private*
  only affects future commits made through GitHub.
- The demo site name `one-atlas-vwgf.atlassian.net` appears in the README, the
  limits doc and the video footer. It is a throwaway Atlassian demo site and it
  is the evidence that the runs were real, so it stays.

Then, in the console:

1. Paste the privacy URL into **Privacy policy** and press **Save changes**.
2. Under **Install this app onto**, tick **Jira** (only Jira; the app has no
   Confluence or Bitbucket modules).
3. Copy the installation link it generates, and test it in a private window
   before you submit — a link that 404s is scored as a broken app.

Judges install from that link. Test it yourself in a private window first — a
link that 404s is scored as a broken app.

---

## 3. Fill in the Devpost form

**Project name**

    Gatekeeper

**Elevator pitch** (one line)

    Agentic incident triage for Jira Service Management where the model proposes,
    deterministic code decides, and nothing executes without a receipt.

**Category:** Apps for Software Teams
**Bonus prizes:** Best Agents, Best app with Atlassian MCP. *(Not Marketplace — see the top of this file.)*

### Inspiration

An AI agent triaging a real incident queue has to be trusted with actions that
are hard to undo: closing someone's outage, reassigning it, moving it through a
workflow. Every product in this space asks you to trust the model more. We
wanted the opposite — a system where the model is useful and load-bearing but
is never the authority, and where you can prove what happened afterwards.

The project justified itself on day one. Asked to triage an issue whose entire
description reads "issue with this thing", the agent reported a critical failure
in a production database connection pool at 0.90 confidence. It invented the
outage. That is not a hypothetical we constructed for a demo — it is in the
audit trail, and the video opens with it.

### What it does

Gatekeeper triages incidents in Jira Service Management:

1. **Correlation runs first, deterministically, before any model is asked
   anything.** Duplicates, flapping, maintenance windows and known-benign
   signatures are closed with a written reason and no tokens spent.
2. **Two Rovo agents** propose: one diagnoses and proposes an action drawn only
   from an allow-list an administrator authored, the other reviews adversarially
   and is never told how confident the first one was.
3. **A twelve-rule policy gate decides.** It is a pure function — no clock, no
   network, no storage — so the same inputs always give the same verdict.
   Reject beats hold beats auto, and nothing can escalate a proposal.
4. **The executor re-derives the verdict itself** and ignores the one it was
   handed, so a forged, stale or replayed verdict cannot cause an action.
5. **Everything leaves a receipt**, chained by sha256 and verified on screen —
   including every change to the rule pack itself, with the person who made it.

### How we built it

Forge, with `rovo:agent` for the two agents, `rovo:mcp` to expose the gate as an
MCP tool, and UI Kit for the issue panel and the rule pack editor. The gate,
evidence handling, executor and receipt chain are plain JavaScript with no Forge
dependency at all, which is why 169 tests run with no runtime, no network and no
credentials.

The design rule we held to: any LLM output gets a deterministic check around it
and leaves evidence — what it saw, a hash, a quote. "The model said so" is not a
result.

### Challenges we ran into

Every real defect came from running it against a live site, not from the tests:

- `@forge/resolver` is CommonJS, and `"type": "module"` made the bundler resolve
  the default import to the module namespace, so every handler threw at import
  time while all tests passed.
- A guard that excluded Gatekeeper's own comments from evidence matched on the
  author's display name — but Jira returns an accountId for app authors, so it
  silently never matched. An agent could have quoted Gatekeeper back at itself
  as corroboration.
- The app invalidated its own pending work: it both wrote to and hashed the same
  issue, so posting a receipt changed the evidence digest and the staleness rule
  rejected everything.
- A `DynamicTable` head passed as a bare array throws inside the UI Kit
  reconciler and renders the **entire panel** blank, with nothing in the logs
  and nothing in the console.

### Accomplishments that we're proud of

R12 caught a real fabrication on its first live run — on an action that had
already executed under the old eleven-rule gate. Not a staged example: the
before and after are both in the same receipt chain, one rule apart.

And the limits document, which was written before anyone asked for it and says
plainly what we have not measured.

### What we learned

A guard that matches on a display name stops guarding the moment the platform
hands you an id. Any system that both writes to and hashes the same record has a
staleness bug waiting in it. And a local test validates your code against your
*model* of the platform — only a real call validates the model.

### What's next for Gatekeeper

A measured noise-reduction number from a real queue with real labels, which is
the one claim we refuse to make up. Rule R12 currently verifies that a citation
exists, not that it supports the conclusion drawn from it. And the rule pack
needs import/export so a posture can move between sites.

### Built With

    atlassian-forge, jira-service-management, rovo, javascript, ui-kit,
    node.js, forge-storage, sha-256

### Try it out

- Installation link: *(from step 2)*
- GitHub: *(repo URL)*
- Demo video: *(from step 1)*

### How it meets the main technology requirement

Gatekeeper is a Forge app, not a hosted service that calls Jira's REST API. It
has a `manifest.yml` with `rovo:agent` (two agents), `rovo:mcp`, three `action`
modules, `jira:issuePanel`, `jira:projectSettingsPage` and `jira:globalPage`.
It integrates with Jira Service Management and with Rovo. All state lives in
Forge storage and every effect goes through the Forge Jira API. It was built
from scratch during the submission period and deployed to production on
19 November 2026.

---

## 4. Put the two links back in the README

Once you have both, one command finishes it — replace the two URLs:

```bash
cd ~/Desktop/PW/hackathons/codegeist-2026 && python3 - <<'EOF'
import pathlib
YOUTUBE = "https://youtu.be/REPLACE_ME"
INSTALL = "https://developer.atlassian.com/console/install/REPLACE_ME"
p = pathlib.Path("README.md"); s = p.read_text()
block = f"\n## Links\n\n- **Install it** (judges start here): {INSTALL}\n- **Demo video** (4:38): {YOUTUBE}\n"
s = s.replace("\n## The demo\n", block + "\n## The demo\n", 1)
p.write_text(s)
print("README updated")
EOF
```

Then confirm both blockers are gone:

```bash
cd ~/Desktop/PW/hackathons/codegeist-2026 && ./scripts/preflight.sh | tail -20
```

It should read `0 blockers`. Commit, push, and submit.

---

## What is already done

- App live and verified end to end on a real Jira site, all five effects
- Deployed to **production** (v2.0.0) as well as development (v2.16.0)
- 169 tests passing, no Forge runtime needed
- `docs/LIMITS.md` — every gap, named
- `video/gatekeeper-demo.mp4` + `.srt`
- 32 commits, clean tree, LICENSE present
