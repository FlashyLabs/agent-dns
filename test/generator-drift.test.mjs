// The generator itself is vendored from FlashyLabs/web4, byte-identical, so the
// institutional front door is one door and not a fork. These files carry no
// per-repository content — everything property-specific lives in
// site.config.json — so each must match its web4 source exactly. Compared
// against the sibling ../web4 checkout when it is beside this one, and reported
// UNKNOWN — never passed — when it is not. node: builtins only, no install.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB4 = join(ROOT, '..', 'web4');

// path here -> path in web4 (the other vendored inputs — vendor-stack.mjs,
// .well-known/stack.json, brand/ and estate-ring.json — carry their own drift
// tests against their own canon: stack-copy, brand and estate-ring).
const VENDORED = [
  ['scripts/build-site.mjs', 'scripts/build-site.mjs'],
  ['scripts/mesh.mjs', 'scripts/mesh.mjs'],
  ['schema/site-config-1.json', 'schema/site-config-1.json'],
  ['vercel.json', 'vercel.json'],
];

for (const [here] of VENDORED) {
  test(`${here} is present`, () => {
    assert.ok(existsSync(join(ROOT, here)), `${here} is missing — re-vendor from web4`);
  });
}

test('the generator set is byte-identical to the web4 source (or UNKNOWN)', () => {
  if (!existsSync(WEB4)) {
    console.log('UNKNOWN: sibling web4 checkout is absent; cannot verify the generator is current');
    return;
  }
  for (const [here, there] of VENDORED) {
    assert.equal(
      readFileSync(join(ROOT, here)).toString('binary'),
      readFileSync(join(WEB4, there)).toString('binary'),
      `${here} has drifted from web4 — re-vendor, never edit the copy`,
    );
  }
});
