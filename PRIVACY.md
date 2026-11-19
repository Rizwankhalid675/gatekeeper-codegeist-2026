# Privacy policy — Gatekeeper

**Last updated 19 November 2026.**

Gatekeeper is an Atlassian Forge app for incident triage in Jira Service
Management. This policy says what it stores, where, and for how long. It was
written by reading the code rather than from a template, and the storage keys
below are the real ones.

Gatekeeper is a hackathon entry (Atlassian Codegeist 2026). It is not a
commercial product and has no analytics, no advertising, and no third-party
processors beyond Atlassian itself.

## Where data goes

**Everything stays inside Atlassian.** Gatekeeper runs on Forge, uses the Forge
storage API, and calls the Jira API of the site it is installed on. It sends
nothing to any server operated by us or by anyone else, and there is no external
endpoint in the app's manifest. The two agents are Atlassian Rovo agents, so
model inference happens inside Atlassian's platform.

## What it stores

In the Forge key-value store, scoped to the installation:

| Key | Contents |
|---|---|
| `rulepack:<PROJECT>` | the project's rule pack — the allow-list, ceilings and thresholds an administrator authored |
| `receipt:<ISSUE>:<SEQ>` and `receipt-head:<ISSUE>` | the audit chain for an issue |
| `receipt:rulepack:<PROJECT>:<SEQ>` | the audit chain for changes to the rule pack |
| `verdict:<ISSUE>` | the most recent gate verdict for an issue |
| `run:<ISSUE>` | the most recent agent proposal and review for an issue |

**This includes personal data**, which is why the app's distribution listing
declares so:

- **Atlassian account IDs.** When a person approves a held action, or changes a
  rule pack, the receipt records them as `user:<accountId>`. That is the point
  of the chain — it has to distinguish "the robot did this" from "a person
  overrode the robot". Account IDs are opaque identifiers, not names or email
  addresses, and Gatekeeper never stores a display name or an email.
- **Issue content.** A verdict and a run record carry the action's parameters
  and the agent's rationale, which can quote text from the issue being triaged —
  its summary, description and comments. If a person's name or contact details
  appear in an issue, they can appear here.

Gatekeeper also posts a comment on the issue for each decision. That comment is
ordinary Jira content and lives under your own Jira retention rules, not ours.

## How long

**Receipts are append-only and are not deleted.** That is a deliberate property:
an audit chain you can edit is not an audit chain. Verdicts and run records are
overwritten each time an issue is re-triaged.

All of it is deleted when the app is uninstalled, because Forge storage is
scoped to the installation and removed with it.

## Who can see it

Only people who can already see the Jira issue. Gatekeeper adds no sharing of
its own, publishes nothing outside your site, and has no administrator view
across installations. We — the app's authors — cannot see your data; we have no
server and no copy of it.

Forge app logs are visible to the app's developer when a site opts into sharing
log access. Gatekeeper's logs carry issue keys and rule outcomes, not issue
text.

## Your choices

- Uninstalling the app deletes everything it stored.
- Setting a project's rule pack to **unattended action: off** stops the app
  acting on its own; it still records what it would have proposed.
- Removing every action from a rule pack stops it acting at all.

## Contact

Questions about this policy: <https://webrizz.dev/contact/>

## Changes

If this policy changes, the date at the top changes with it, and the history is
in this file's git history.
