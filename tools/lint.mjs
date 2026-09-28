#!/usr/bin/env node
// Zero-install lint: syntax-check every .mjs, and hold the house rules that
// have a byte-checkable shape. Exit 1 on any failure.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['.git', 'node_modules']);
const LICENCE_LINE =
  'Licence: to be declared at launch. The estate licence register in flashyos governs; this repository is not yet open-sourced.';

const failures = [];
const fail = (msg) => failures.push(msg);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const rel = (f) => relative(ROOT, f);

// 1. Every .mjs parses.
const mjs = files.filter((f) => f.endsWith('.mjs'));
for (const file of mjs) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) fail(`${rel(file)}: node --check failed\n${r.stderr}`);
}

// 2. Every .mjs imports node: builtins or relative paths only — nothing from a registry.
for (const file of mjs) {
  const src = readFileSync(file, 'utf8');
  const specifiers = [...src.matchAll(/^\s*(?:import|export)\b[^'"\n]*?\bfrom\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
  for (const s of specifiers) {
    if (!s.startsWith('node:') && !s.startsWith('.') && !s.startsWith('/')) {
      fail(`${rel(file)}: imports ${JSON.stringify(s)}; only node: builtins and relative paths are allowed`);
    }
  }
}

// 3. Every JSON file parses.
for (const file of files.filter((f) => f.endsWith('.json'))) {
  try {
    JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    fail(`${rel(file)}: invalid JSON: ${e.message}`);
  }
}

// 4. No dependencies of any kind in package.json.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
  if (pkg[field] && Object.keys(pkg[field]).length > 0) fail(`package.json: ${field} must be empty`);
}
if (pkg.type !== 'module') fail('package.json: "type" must be "module"');

// 5. The licence is declared once, elsewhere: no LICENSE file here, and the README says so in its last line.
for (const name of ['LICENSE', 'LICENSE.md', 'LICENCE', 'LICENCE.md', 'LICENSE.txt']) {
  if (existsSync(join(ROOT, name))) fail(`${name}: this repository does not declare its own licence`);
}
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8').trimEnd().split('\n');
if (readme[readme.length - 1] !== LICENCE_LINE) fail(`README.md: last line must be exactly: ${LICENCE_LINE}`);

// 6. No credential shapes in the tree.
const CREDENTIAL_SHAPES = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}\b/,
  /\bsk-[A-Za-z0-9]{32,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\b[0-9]{8,10}:[A-Za-z0-9_-]{35}\b/,
];
for (const file of files.filter((f) => !/\.(png|jpg|gif|ico|woff2?)$/.test(f))) {
  const text = readFileSync(file, 'utf8');
  for (const shape of CREDENTIAL_SHAPES) {
    if (shape.test(text)) fail(`${rel(file)}: matches credential shape ${shape}`);
  }
}

if (failures.length > 0) {
  for (const f of failures) process.stderr.write(`lint: ${f}\n`);
  process.exit(1);
}
process.stdout.write(`lint: ${mjs.length} .mjs files parse; house rules hold\n`);
