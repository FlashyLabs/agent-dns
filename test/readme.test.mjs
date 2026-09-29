// The README is this repository's cover page and part of its institutional
// front door: a level-1 heading first, the bolt mark beside it, a
// "Where it sits in the stack" section that links the Web 4 hub and its machine
// twin, a draft status line, and the estate licence line last. Every
// github.com/FlashyLabs repo it links is in one allowlist here — a typo fails
// the suite. Modelled on web4's readme.test.mjs, with the allowlist adapted to
// this repository. node: builtins only, no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');

// Every github.com/FlashyLabs/<name> the README may link. Add here first.
const ALLOW = ['web4', 'stack.json', 'agent-dns'];
const LICENCE_LINE =
  'Licence: to be declared at launch. The estate licence register in flashyos governs; this repository is not yet open-sourced.';

test('the first line is a level-1 heading', () => {
  assert.match(readme, /^# \S.*\n/, 'the README must open with a level-1 heading');
});

test('the bolt mark sits beside the H1 and is a file the brand manifest covers', () => {
  assert.match(readme, /<img src="brand\/assets\/bolt-gold\.svg" width="48" alt="">/);
  const manifest = readFileSync(join(ROOT, 'brand', 'MANIFEST.sha256'), 'utf8');
  assert.match(manifest, /assets\/bolt-gold\.svg$/m, 'the bolt the README shows is not in the brand manifest');
});

test('a "Where it sits in the stack" section links the hub and its twin', () => {
  const at = readme.indexOf('\n## Where it sits in the stack\n');
  assert.ok(at !== -1, 'missing the "Where it sits in the stack" section');
  const section = readme.slice(at);
  assert.match(section, /github\.com\/FlashyLabs\/web4/, 'the section must link the Web 4 hub');
  assert.match(section, /github\.com\/FlashyLabs\/stack\.json/, 'the section must link the stack.json twin');
});

test('every FlashyLabs repo link is in the allowlist', () => {
  const linked = [...readme.matchAll(/github\.com\/FlashyLabs\/([^\s)\/#"'`]+)/g)].map((m) => m[1]);
  assert.ok(linked.length > 0, 'the README links no FlashyLabs repository');
  const unknown = linked.filter((r) => !ALLOW.includes(r));
  assert.deepEqual(unknown, [], `README links repos not in the allowlist: ${unknown.join(', ')}`);
});

test('the README carries a draft status line', () => {
  assert.match(readme, /^Status: draft/m);
});

test('the licence line is the last line, exactly once', () => {
  assert.equal(readme.split(LICENCE_LINE).length - 1, 1, 'the licence line must appear exactly once');
  assert.equal(readme.trimEnd().split('\n').at(-1), LICENCE_LINE, 'the licence line must be last');
});
