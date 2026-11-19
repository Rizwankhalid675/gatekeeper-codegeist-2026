/**
 * jira.js — the only module in Gatekeeper that talks to Jira.
 *
 * Two halves:
 *   - `fetchIncident` and friends, which READ the facts the evidence bundle is
 *     built from;
 *   - `forgeEffects`, the five functions the executor is allowed to call.
 *
 * `forgeEffects` is deliberately a closed set. There is no generic
 * "call this Jira endpoint" helper here, because the moment one exists, an
 * action id becomes a path to arbitrary API calls and the allow-list stops
 * meaning anything.
 */

import api, { route } from '@forge/api';

/** @param {Response} res @param {string} what */
async function ok(res, what) {
  if (res.status >= 200 && res.status < 300) return res;
  // The body carries Jira's actual complaint ("transition is not valid",
  // "field 'labels' cannot be set"). Swallowing it leaves an operator with
  // "something failed", so it is included.
  let detail = '';
  try {
    detail = await res.text();
  } catch {
    detail = '<no body>';
  }
  throw new Error(`${what} failed: HTTP ${res.status} ${detail.slice(0, 400)}`);
}

/**
 * Read one issue and reduce it to the fields the evidence bundle needs.
 *
 * @param {string} issueKey
 */
export async function fetchIncident(issueKey) {
  const res = await api
    .asApp()
    .requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary,description,priority,status,components,created,project`);
  await ok(res, `read ${issueKey}`);
  const data = await res.json();
  const f = data.fields || {};

  return {
    issueKey: data.key,
    projectKey: f.project?.key || data.key.split('-')[0],
    summary: f.summary || '',
    description: plainText(f.description),
    priority: f.priority?.name || 'None',
    status: f.status?.name || 'Unknown',
    component: f.components?.[0]?.name,
    createdAt: f.created || new Date().toISOString(),
  };
}

/**
 * Jira's v3 API returns descriptions and comments as Atlassian Document Format.
 * The agents and the quote check need plain text, and — importantly — the SAME
 * plain text every time, or the evidence digest changes without the issue
 * changing. So this walks the document deterministically rather than relying on
 * a renderer.
 *
 * @param {any} adf
 * @returns {string}
 */
export function plainText(adf) {
  if (!adf) return '';
  if (typeof adf === 'string') return adf;

  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text' && typeof node.text === 'string') out.push(node.text);
    if (node.type === 'hardBreak') out.push('\n');
    if (Array.isArray(node.content)) {
      node.content.forEach(walk);
      // Block-level nodes end with a newline so two adjacent paragraphs do not
      // run together into a sentence that was never written.
      if (['paragraph', 'heading', 'listItem', 'blockquote', 'codeBlock'].includes(node.type)) out.push('\n');
    }
  };
  walk(adf);
  return out.join('').replace(/\n{3,}/g, '\n\n').trim();
}

/** @param {string} issueKey */
export async function fetchComments(issueKey) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/comment?maxResults=50&orderBy=created`);
  await ok(res, `read comments on ${issueKey}`);
  const data = await res.json();
  return (data.comments || []).map((c) => ({
    author: c.author?.accountId === undefined && c.author?.displayName ? c.author.displayName : c.author?.accountId || 'unknown',
    // Jira marks app-authored comments with accountType 'app'. This is the only
    // reliable way to recognise our own receipt comments: the display name is
    // whatever the app is called, and `author` above is an accountId, which
    // never matches a name-based check.
    authorType: c.author?.accountType || 'atlassian',
    body: plainText(c.body),
    createdAt: c.created,
  }));
}

/** @param {string} issueKey */
export async function fetchLinkedIssues(issueKey) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}?fields=issuelinks`);
  await ok(res, `read links on ${issueKey}`);
  const data = await res.json();
  const links = data.fields?.issuelinks || [];
  return links
    .map((l) => l.outwardIssue || l.inwardIssue)
    .filter(Boolean)
    .map((i) => ({ key: i.key, summary: i.fields?.summary || '', status: i.fields?.status?.name || 'Unknown' }));
}

/**
 * Recent issues in the project, for correlation. Only the fields the signature
 * needs — this runs on every triage, so it stays cheap.
 *
 * @param {string} projectKey
 * @param {number} withinMinutes
 */
export async function fetchRecentIssues(projectKey, withinMinutes) {
  const minutes = Math.max(1, Math.round(withinMinutes || 60));
  const jql = `project = "${projectKey}" AND created >= -${minutes}m ORDER BY created DESC`;
  const res = await api
    .asApp()
    .requestJira(route`/rest/api/3/search/jql?jql=${jql}&maxResults=100&fields=summary,components,created,project`);
  await ok(res, `search ${projectKey}`);
  const data = await res.json();
  return (data.issues || []).map((i) => ({
    issueKey: i.key,
    projectKey: i.fields?.project?.key || projectKey,
    summary: i.fields?.summary || '',
    component: i.fields?.components?.[0]?.name,
    createdAt: i.fields?.created,
  }));
}

/**
 * The five effects, and only these five. The executor's effect map names them;
 * nothing else in the app writes to Jira.
 *
 * @type {import('../executor.js').Effects}
 */
export const forgeEffects = {
  async comment(issueKey, body) {
    const res = await api
      .asApp()
      .requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: {
            type: 'doc',
            version: 1,
            content: String(body)
              .split('\n')
              .map((line) => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] })),
          },
        }),
      });
    await ok(res, `comment on ${issueKey}`);
  },

  async transition(issueKey, to) {
    // Transition NAMES are what a rule pack can sensibly allow-list; ids differ
    // per workflow and per site, so the name is resolved to an id here against
    // the transitions Jira actually offers right now.
    const listRes = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`);
    await ok(listRes, `read transitions for ${issueKey}`);
    const { transitions = [] } = await listRes.json();
    const match = transitions.find((t) => t.name?.toLowerCase() === String(to).toLowerCase());
    if (!match) {
      throw new Error(
        `transition "${to}" is not available on ${issueKey} right now. Available: ${
          transitions.map((t) => t.name).join(', ') || 'none'
        }`,
      );
    }
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/transitions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transition: { id: match.id } }),
    });
    await ok(res, `transition ${issueKey} to ${to}`);
  },

  async assign(issueKey, accountId) {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}/assignee`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId }),
    });
    await ok(res, `assign ${issueKey}`);
  },

  async link(issueKey, otherKey, type = 'Duplicate') {
    const res = await api.asApp().requestJira(route`/rest/api/3/issueLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: { name: type },
        inwardIssue: { key: issueKey },
        outwardIssue: { key: otherKey },
      }),
    });
    await ok(res, `link ${issueKey} to ${otherKey}`);
  },

  async label(issueKey, label) {
    const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueKey}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ update: { labels: [{ add: String(label) }] } }),
    });
    await ok(res, `label ${issueKey}`);
  },
};
