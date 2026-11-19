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
