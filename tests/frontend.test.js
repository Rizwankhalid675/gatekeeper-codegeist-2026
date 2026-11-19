/**
 * frontend.test.js — static checks on the UI Kit front ends.
 *
 * These exist because of a bug that cost an hour: `<DynamicTable head={[...]}>`
 * with a bare array instead of `{ cells: [...] }`. DynamicTable throws, the throw
 * escapes the UI Kit reconciler, and the ENTIRE panel renders blank — header
 * present, body empty, no error on screen, nothing in `forge logs`, nothing in
 * the browser console (the Forge iframe is cross-origin).
 *
 * Worse, it was invisible until there was data: the receipts table is only
 * reached once a receipt exists, so the panel looked healthy on every fresh
 * issue and broke the moment Gatekeeper did anything.
 *
 * There is no renderer here to catch that, so these are deliberately crude
 * string checks. A crude check that runs beats a proper one that does not.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { EFFECT } from '../src/shared/contracts.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'src/frontend');
const files = readdirSync(dir).filter((f) => f.endsWith('.jsx'));

test('there is at least one front end to check', () => {
  assert.ok(files.length > 0);
});

for (const file of files) {
  const source = readFileSync(join(dir, file), 'utf8');

  test(`${file}: DynamicTable head is never a bare array`, () => {
    assert.ok(
      !/head=\{\s*\[/.test(source),
      `${file} passes head as an array; DynamicTable needs { cells: [...] } and throws otherwise, blanking the whole page`,
    );
  });

  test(`${file}: every DynamicTable head resolves to an object with cells`, () => {
    if (!source.includes('<DynamicTable')) return;

    // Either inline `head={{ cells:` or a variable whose declaration is an
    // object containing `cells:`.
    const inline = /head=\{\{\s*cells\s*:/.test(source);
    const viaVariable = [...source.matchAll(/head=\{(\w+)\}/g)].every(([, name]) => {
      const decl = new RegExp(`const\\s+${name}\\s*=\\s*\\{[\\s\\S]{0,80}?cells\\s*:`);
      return decl.test(source);
    });
    const hasVariableForm = /head=\{\w+\}/.test(source);

    assert.ok(
      inline || (hasVariableForm && viaVariable),
      `${file}: could not confirm every DynamicTable head is { cells: [...] }`,
    );
  });

  test(`${file}: invoke() rejections are handled, so a dead resolver cannot spin forever`, () => {
    // The other way this panel failed silently: invoke() REJECTS when the
    // resolver cannot load, and an unhandled rejection leaves the spinner up
    // with no error, which is what a judge would have seen.
    if (!source.includes('invoke(')) return;
    assert.ok(
      source.includes('.catch(') || /try\s*\{[\s\S]*await invoke/.test(source),
      `${file} awaits invoke() without catching a rejection`,
    );
  });
}

// --- the editor can now author actions, so what it offers must be real -------

test('settings.jsx offers exactly the five effects the executor can dispatch', () => {
  // The editor adds actions now. An effect it offers that the executor has no
  // case for would produce an action that passes all twelve rules and then
  // fails at execution — authorised, attempted, and impossible.
  const source = readFileSync(join(dir, 'settings.jsx'), 'utf8');
  const m = source.match(/const EFFECTS = \[([^\]]+)\]/);
  assert.ok(m, 'settings.jsx must declare its effect list as a plain array so this check can read it');

  const offered = m[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);

  assert.deepEqual(new Set(offered), new Set(Object.values(EFFECT)));
});

test('every @forge/react component the front ends import actually exists', () => {
  // A component name that is not exported arrives as undefined, and rendering
  // undefined throws inside the reconciler — which is the blank-page failure
  // above, by a different route. The installed package is the source of truth.
  // Read every module in the package's components directory, not just the big
  // ui-kit-components one: DynamicTable, Popup, Comment and the ADF renderer
  // each live in their own file, so a narrower source of truth produces a false
  // failure on a component that is perfectly real.
  const kitDir = join(root, 'node_modules/@forge/react/out/components');
  const exported = new Set();
  for (const f of readdirSync(kitDir).filter((f) => f.endsWith('.js'))) {
    for (const m of readFileSync(join(kitDir, f), 'utf8').matchAll(/exports\.([A-Z][A-Za-z]+)/g)) {
      exported.add(m[1]);
    }
  }
  assert.ok(exported.size > 20, 'could not read the UI Kit export list; this check is not actually checking');

  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8');
    const block = source.match(/import ForgeReconciler, \{([\s\S]*?)\} from '@forge\/react'/);
    if (!block) continue;
    for (const name of block[1].split(',').map((s) => s.trim()).filter(Boolean)) {
      assert.ok(exported.has(name), `${file} imports ${name} from @forge/react, which does not export it`);
    }
  }
});

test('no Textfield is controlled, because UI Kit loses keystrokes when they are', () => {
  // Found live: an id typed as "escalate-to-vendor" arrived as "!". A
  // controlled Textfield re-renders through the iframe bridge on every
  // keystroke and snaps the field back to the state it was handed, so typing
  // outruns the round trip. defaultValue + onChange/onBlur keeps what the user
  // typed; a `key` that changes is how such a field gets cleared.
  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8');
    for (const [block] of source.matchAll(/<Textfield[\s\S]*?\/>/g)) {
      assert.ok(
        !/^\s*value=\{/m.test(block),
        `${file} has a controlled <Textfield value={...}>; use defaultValue and a changing key instead:\n${block}`,
      );
    }
  }
});

test('no front end hardcodes how many rules there are', () => {
  // "Rules that passed (10 of 11)" under a verdict carrying twelve outcomes.
  // That denominator is the one number on the panel an auditor would use to
  // check nothing had been dropped, and a literal silently stops matching the
  // moment a rule is added. Count the outcomes instead.
  for (const file of files) {
    const source = readFileSync(join(dir, file), 'utf8');
    assert.ok(
      !/of \d+\)/.test(source),
      `${file} hardcodes a rule count; derive it from verdict.outcomes.length`,
    );
  }
});
