/**
 * manifest.test.js — cross-reference the manifest against the code.
 *
 * `forge lint` validates the manifest's shape, but it needs an Atlassian login,
 * so it cannot run in CI or on a fresh clone. These checks cover the class of
 * mistake that lint would not catch anyway: a reference that is internally
 * consistent in YAML but points at a function nobody exported, or a resource
 * file that is not on disk.
 *
 * Every failure here is a mistake that deploys cleanly and then breaks in a
 * judge's test site, which is the worst possible place to find it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import yaml from 'js-yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = yaml.load(readFileSync(join(root, 'manifest.yml'), 'utf8'));
const modules = manifest.modules || {};

const actionKeys = new Set((modules.action || []).map((a) => a.key));
const functionKeys = new Set((modules.function || []).map((f) => f.key));
const resourceKeys = new Set((manifest.resources || []).map((r) => r.key));

const ALLOWED_VERBS = new Set(['GET', 'CREATE', 'UPDATE', 'DELETE', 'TRIGGER']);

/** Every module group that renders a UI Kit page and therefore needs a resolver. */
const UI_KIT_GROUPS = ['jira:issuePanel', 'jira:projectSettingsPage', 'jira:adminPage', 'jira:globalPage'];
const ALLOWED_INPUT_TYPES = new Set(['string', 'integer', 'number', 'boolean']);

test('every action an agent lists actually exists', () => {
  for (const agent of modules['rovo:agent'] || []) {
    for (const key of agent.actions || []) {
      assert.ok(actionKeys.has(key), `agent "${agent.key}" lists action "${key}", which is not defined`);
    }
  }
});

test('every action points at a declared function', () => {
  for (const action of modules.action || []) {
    assert.ok(action.function, `action "${action.key}" has no function`);
    assert.ok(functionKeys.has(action.function), `action "${action.key}" points at undeclared function "${action.function}"`);
  }
});

test('every declared function is actually exported by src/index.js', () => {
  // The check that matters most. `handler: index.triageIncidnet` is valid YAML,
  // passes lint, deploys, and then fails the first time a judge uses it.
  const source = readFileSync(join(root, 'src/index.js'), 'utf8');
  for (const fn of modules.function || []) {
    const [file, name] = String(fn.handler).split('.');
    assert.equal(file, 'index', `function "${fn.key}" uses handler file "${file}"; only index is wired up`);
    const exported =
      new RegExp(`export\\s+(async\\s+)?function\\s+${name}\\b`).test(source) ||
      new RegExp(`export\\s+const\\s+${name}\\b`).test(source);
    assert.ok(exported, `src/index.js does not export "${name}", required by function "${fn.key}"`);
  }
});

test('every function declared in the manifest is referenced by something', () => {
  const referenced = new Set();
  for (const action of modules.action || []) referenced.add(action.function);
  for (const group of UI_KIT_GROUPS) {
    for (const m of modules[group] || []) if (m.resolver?.function) referenced.add(m.resolver.function);
  }
  for (const fn of modules.function || []) {
    assert.ok(referenced.has(fn.key), `function "${fn.key}" is declared but nothing uses it`);
  }
});

test('actionVerb is one of the five Forge allows', () => {
  for (const action of modules.action || []) {
    assert.ok(ALLOWED_VERBS.has(action.actionVerb), `action "${action.key}" has actionVerb "${action.actionVerb}"`);
  }
});

test('an action that can change an issue is not marked GET', () => {
  // The verb is not cosmetic: Atlassian automation refuses to invoke
  // CREATE/UPDATE/DELETE actions. Marking a writing action GET would let an
  // automation rule drive it with nobody in the conversation.
  const writing = ['triage-incident', 'review-proposal'];
  for (const key of writing) {
    const action = (modules.action || []).find((a) => a.key === key);
    assert.ok(action, `expected an action "${key}"`);
    assert.notEqual(action.actionVerb, 'GET', `"${key}" can change state and must not be GET`);
  }
});

test('every action input has a permitted type and a description', () => {
  for (const action of modules.action || []) {
    for (const [name, spec] of Object.entries(action.inputs || {})) {
      assert.ok(ALLOWED_INPUT_TYPES.has(spec.type), `${action.key}.${name} has type "${spec.type}"`);
      assert.ok(spec.title, `${action.key}.${name} needs a title`);
      // The description is what the model reads to decide how to fill the
      // field. An undescribed input is an input that gets filled with junk.
      assert.ok(spec.description, `${action.key}.${name} needs a description — the agent reads it`);
      assert.equal(typeof spec.required, 'boolean', `${action.key}.${name}: required must be a boolean`);
    }
  }
});

test('the MCP module exposes only read-only tools', () => {
  // The security claim in the README: an outside agent may inspect this
  // project's policy, never act through it. If triage-incident or
  // review-proposal ever appears here, that claim is false.
  const mcp = (modules['rovo:mcp'] || [])[0];
  assert.ok(mcp, 'expected a rovo:mcp module');
  for (const tool of mcp.tools) {
    assert.ok(actionKeys.has(tool), `MCP exposes "${tool}", which is not a defined action`);
    const action = (modules.action || []).find((a) => a.key === tool);
    assert.equal(action.actionVerb, 'GET', `MCP tool "${tool}" is ${action.actionVerb}; only GET may be exposed`);
  }
  assert.ok(!mcp.tools.includes('triage-incident'), 'triage-incident must never be an MCP tool');
  assert.ok(!mcp.tools.includes('review-proposal'), 'review-proposal must never be an MCP tool');
});

test('only the reviewer agent can submit a review', () => {
  // R07 is only meaningful if the proposing agent cannot clear it itself.
  const agents = modules['rovo:agent'] || [];
  const proposer = agents.find((a) => a.key === 'gatekeeper-agent');
  const reviewer = agents.find((a) => a.key === 'gatekeeper-reviewer');

  assert.ok(proposer && reviewer, 'both the proposing and reviewing agents must exist');
  assert.ok(
    !(proposer.actions || []).includes('review-proposal'),
    'the proposing agent must not be able to review its own proposal',
  );
  assert.ok((reviewer.actions || []).includes('review-proposal'));
  assert.ok(
    !(reviewer.actions || []).includes('triage-incident'),
    'the reviewer must not be able to propose actions either',
  );
});

test('every resource key referenced by a module exists, and its path is on disk', () => {
  for (const r of manifest.resources || []) {
    const p = join(root, r.path);
    assert.ok(existsSync(p), `resource "${r.key}" points at ${r.path}, which does not exist`);
  }

  for (const group of UI_KIT_GROUPS) {
    for (const m of modules[group] || []) {
      assert.ok(resourceKeys.has(m.resource), `${group} "${m.key}" uses undeclared resource "${m.resource}"`);
    }
  }
});

test('every resource:key;file reference resolves to a real file', () => {
  // Covers the agent prompts and the panel icon. This is the exact error the
  // real forge lint gave us for a missing agent.md, caught here without a login.
  const text = readFileSync(join(root, 'manifest.yml'), 'utf8');
  const refs = [...text.matchAll(/resource:([A-Za-z0-9_-]+);([^\s'"]+)/g)];
  assert.ok(refs.length > 0, 'expected at least one resource:key;file reference');

  for (const [, key, file] of refs) {
    const r = (manifest.resources || []).find((x) => x.key === key);
    assert.ok(r, `reference to unknown resource key "${key}"`);
    const dir = join(root, r.path);
    assert.ok(statSync(dir).isDirectory(), `resource "${key}" must be a directory to hold "${file}"`);
    assert.ok(existsSync(join(dir, file)), `resource "${key}" has no file "${file}"`);
  }
});

test('UI Kit modules declare render: native and a resolver', () => {
  for (const group of UI_KIT_GROUPS) {
    for (const m of modules[group] || []) {
      assert.equal(m.render, 'native', `${group} "${m.key}" needs render: native for UI Kit`);
      assert.ok(m.resolver?.function, `${group} "${m.key}" needs a resolver function`);
      assert.ok(functionKeys.has(m.resolver.function), `${group} "${m.key}" points at an undeclared resolver`);
    }
  }
});

test('an issue panel declares a title and an icon', () => {
  for (const m of modules['jira:issuePanel'] || []) {
    assert.ok(m.title, `issue panel "${m.key}" needs a title`);
    assert.ok(m.icon, `issue panel "${m.key}" needs an icon`);
  }
});

test('agent and MCP names fit the 30-character limit Forge enforces', () => {
  for (const agent of modules['rovo:agent'] || []) {
    assert.ok(agent.name.length <= 30, `agent "${agent.key}" name is ${agent.name.length} characters`);
    assert.ok(agent.prompt, `agent "${agent.key}" needs a prompt`);
    assert.ok(agent.description, `agent "${agent.key}" needs a description — users read it`);
  }
  for (const mcp of modules['rovo:mcp'] || []) {
    assert.ok(mcp.name.length <= 30, `mcp "${mcp.key}" name is ${mcp.name.length} characters`);
  }
});

test('all module keys are unique across the whole manifest', () => {
  const seen = new Map();
  for (const [group, entries] of Object.entries(modules)) {
    for (const entry of entries) {
      assert.ok(!seen.has(entry.key), `key "${entry.key}" is used by both ${seen.get(entry.key)} and ${group}`);
      seen.set(entry.key, group);
      assert.match(entry.key, /^[a-zA-Z0-9_-]+$/, `key "${entry.key}" has characters Forge does not allow`);
    }
  }
});

test('the app declares a runtime and exactly the scopes it uses', () => {
  assert.ok(manifest.app?.runtime?.name, 'app.runtime.name is required');
  const scopes = manifest.permissions?.scopes || [];
  assert.deepEqual(
    [...scopes].sort(),
    ['read:jira-work', 'storage:app', 'write:jira-work'],
    'scopes changed — widen them only deliberately, and update docs/LIMITS.md when you do',
  );
});

test('no manifest string exceeds the 255-character limit Forge enforces', () => {
  // Learned from the real linter, not the docs: forge deploy refuses the whole
  // manifest with "must NOT have more than 255 characters", and because the
  // schema uses oneOf, the failing branch ALSO reports a misleading "action
  // required properties are ..." error that sends you looking in the wrong place.
  const over = [];
  const walk = (node, path) => {
    if (node === null || typeof node !== 'object') return;
    for (const [k, v] of Object.entries(node)) {
      const p = `${path}.${k}`;
      if (typeof v === 'string') {
        if (v.length > 255) over.push(`${p} is ${v.length} characters`);
      } else walk(v, p);
    }
  };
  walk(manifest, 'manifest');
  assert.deepEqual(over, [], `over the 255-character limit:\n  ${over.join('\n  ')}`);
});

test('the app id is a well-formed ARI', () => {
  // A placeholder is expected in the repo; forge register writes the real one.
  // What must not happen is a malformed value that fails at deploy time.
  assert.match(
    String(manifest.app?.id),
    /^ari:cloud:ecosystem::app\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    'app.id must be a valid app ARI',
  );
});
