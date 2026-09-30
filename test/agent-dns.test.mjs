import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import {
  CONTRACT,
  DEFAULTS,
  STATES,
  checkVector,
  isSameDomain,
  isValidHostname,
  parseRecord,
  recordName,
  resolve,
  selectRecord,
  validateRecord,
} from '../vendor-agent-dns.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'vendor-agent-dns.mjs');
const VECTORS_DIR = join(ROOT, 'vectors');
const DOC_URL = 'https://example.com/.well-known/agent';
const GOOD = `v=agent1; url=${DOC_URL}`;

const loadVectors = () =>
  readdirSync(VECTORS_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => ({ file: f, vector: JSON.parse(readFileSync(join(VECTORS_DIR, f), 'utf8')) }));

/** In-memory transports. `txt` maps DNS name → string[]; `docs` maps url → response. */
function transports({ txt = {}, docs = {} } = {}) {
  const calls = { lookups: [], fetches: [] };
  return {
    calls,
    lookupTxt: async (name) => {
      calls.lookups.push(name);
      const v = txt[name];
      if (v instanceof Error) throw v;
      return v ?? [];
    },
    fetcher: async (url) => {
      calls.fetches.push(url);
      const r = docs[url];
      if (r instanceof Error) throw r;
      if (typeof r === 'function') return r();
      return r ?? { status: 404 };
    },
  };
}

const jsonResponse = (obj, headers = {}) => ({ status: 200, headers, body: JSON.stringify(obj) });

// ---------------------------------------------------------------------------

describe('vectors', () => {
  const vectors = loadVectors();

  test('there are at least 3 valid and at least 6 invalid vectors', () => {
    const valid = vectors.filter((v) => v.vector.expect.state === 'ok');
    const invalid = vectors.filter((v) => v.vector.expect.state === 'invalid');
    assert.ok(valid.length >= 3, `valid: ${valid.length}`);
    assert.ok(invalid.length >= 6, `invalid: ${invalid.length}`);
    const reasons = new Set(invalid.map((v) => v.vector.expect.reason));
    for (const r of ['url-not-https', 'url-cross-host', 'missing-url', 'missing-version', 'unknown-key', 'duplicate-records']) {
      assert.ok(reasons.has(r), `an invalid vector covers ${r}`);
    }
  });

  test('every vector names the contract, a domain, records and an expected state', () => {
    for (const { file, vector } of vectors) {
      assert.equal(vector.contract, CONTRACT, file);
      assert.equal(typeof vector.domain, 'string', file);
      assert.ok(Array.isArray(vector.records), file);
      assert.ok(STATES.includes(vector.expect.state), file);
    }
  });

  for (const { file, vector } of vectors) {
    test(`${file} behaves as its expect says`, () => {
      const result = checkVector(vector);
      assert.deepEqual(result.mismatches, [], JSON.stringify(result.actual));
      assert.ok(result.pass);
    });
  }

  test('a file name says what its vector expects', () => {
    for (const { file, vector } of vectors) {
      const prefix = file.split('-')[0];
      const want = { valid: 'ok', invalid: 'invalid', absent: 'absent' }[prefix];
      assert.equal(vector.expect.state, want, file);
    }
  });

  test('the schema admits every valid vector record and refuses the shape rules', () => {
    const schema = JSON.parse(readFileSync(join(ROOT, 'schema', 'agent-dns-1.json'), 'utf8'));
    assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.deepEqual(schema.required, ['v', 'url']);
    assert.equal(schema.additionalProperties, false);
    assert.equal(schema.properties.v.const, 'agent1');
    const extension = new RegExp(Object.keys(schema.patternProperties)[0]);
    const urlPattern = new RegExp(schema.properties.url.pattern);
    for (const { file, vector } of vectors.filter((v) => v.vector.expect.state === 'ok')) {
      const { record } = selectRecord(vector.domain, vector.records);
      for (const key of Object.keys(record)) {
        assert.ok(key in schema.properties || extension.test(key), `${file}: ${key} admitted by schema`);
      }
      assert.match(record.url, urlPattern, file);
    }
  });
});

// ---------------------------------------------------------------------------

describe('parseRecord', () => {
  test('parses a minimal record', () => {
    const r = parseRecord(GOOD);
    assert.equal(r.valid, true);
    assert.deepEqual(r.record, { v: 'agent1', url: DOC_URL });
    assert.deepEqual(r.errors, []);
  });

  test('accepts optional spaces after ";" and one trailing ";"', () => {
    assert.equal(parseRecord('v=agent1;url=https://example.com/a;').valid, true);
    assert.equal(parseRecord('v=agent1;   url=https://example.com/a').valid, true);
  });

  test('carries x- extension keys through and refuses other unknown keys', () => {
    assert.equal(parseRecord(`${GOOD}; x-anything=1`).valid, true);
    const r = parseRecord(`${GOOD}; capability=chat`);
    assert.equal(r.valid, false);
    assert.deepEqual(r.errors.map((e) => e.code), ['unknown-key']);
  });

  test('refuses a bare "x-" key and uppercase keys', () => {
    assert.deepEqual(parseRecord(`${GOOD}; x-=1`).errors.map((e) => e.code), ['unknown-key']);
    assert.deepEqual(parseRecord('V=agent1; url=https://example.com/a').errors.map((e) => e.code), ['invalid-key', 'missing-version']);
  });

  test('requires v first, then agent1', () => {
    assert.deepEqual(parseRecord(`url=${DOC_URL}; v=agent1`).errors.map((e) => e.code), ['version-not-first']);
    assert.deepEqual(parseRecord(`v=agent2; url=${DOC_URL}`).errors.map((e) => e.code), ['unsupported-version']);
    assert.deepEqual(parseRecord(`url=${DOC_URL}`).errors.map((e) => e.code), ['missing-version']);
  });

  test('refuses empty, non-string, malformed and repeated pairs', () => {
    assert.deepEqual(parseRecord('').errors.map((e) => e.code), ['empty-record']);
    assert.deepEqual(parseRecord(42).errors.map((e) => e.code), ['not-a-string']);
    assert.deepEqual(parseRecord('v=agent1; url').errors.map((e) => e.code), ['malformed-pair', 'missing-url']);
    assert.deepEqual(parseRecord('v=agent1;; url=https://example.com/a').errors.map((e) => e.code), ['empty-pair']);
    assert.deepEqual(parseRecord(`${GOOD}; url=https://example.com/b`).errors.map((e) => e.code), ['duplicate-key']);
    assert.deepEqual(parseRecord('v=agent1; url=').errors.map((e) => e.code), ['invalid-value', 'missing-url']);
  });

  test('refuses a value containing whitespace — the grammar is visible ASCII', () => {
    assert.deepEqual(parseRecord('v=agent1; url=https://example.com/a b').errors.map((e) => e.code), ['invalid-value', 'missing-url']);
  });

  test('org must be org/<slug>', () => {
    assert.equal(parseRecord(`${GOOD}; org=org/acme-1`).valid, true);
    assert.deepEqual(parseRecord(`${GOOD}; org=acme`).errors.map((e) => e.code), ['invalid-org']);
  });

  test('does not know about the domain — that is validateRecord', () => {
    assert.equal(parseRecord('v=agent1; url=http://example.net/a').valid, true);
  });
});

// ---------------------------------------------------------------------------

describe('validateRecord', () => {
  const rec = (url, extra = {}) => ({ v: 'agent1', url, ...extra });
  const codes = (record, domain) => validateRecord(record, domain).errors.map((e) => e.code);

  test('accepts the url on the domain itself or a subdomain of it', () => {
    assert.equal(validateRecord(rec(DOC_URL), 'example.com').valid, true);
    assert.equal(validateRecord(rec('https://agents.example.com/a'), 'example.com').valid, true);
    assert.equal(validateRecord(rec('https://EXAMPLE.com./a'), 'Example.COM').valid, true);
    assert.equal(validateRecord(rec('https://example.com:8443/a'), 'example.com').valid, true);
  });

  test('refuses a non-https url', () => {
    assert.deepEqual(codes(rec('http://example.com/a'), 'example.com'), ['url-not-https']);
    assert.deepEqual(codes(rec('ftp://example.com/a'), 'example.com'), ['url-not-https']);
    assert.deepEqual(codes(rec('mailto:agent@example.com'), 'example.com'), ['url-not-https', 'url-cross-host']);
  });

  test('refuses a url on another host, a parent host, or a lookalike host', () => {
    assert.deepEqual(codes(rec('https://example.net/a'), 'example.com'), ['url-cross-host']);
    assert.deepEqual(codes(rec('https://example.com/a'), 'shop.example.com'), ['url-cross-host']);
    assert.deepEqual(codes(rec('https://notexample.com/a'), 'example.com'), ['url-cross-host']);
  });

  test('refuses a missing, unparseable or credentialed url', () => {
    assert.deepEqual(codes({ v: 'agent1' }, 'example.com'), ['missing-url']);
    assert.deepEqual(codes(rec('https://'), 'example.com'), ['url-unparseable']);
    assert.deepEqual(codes(rec('https://u:p@example.com/a'), 'example.com'), ['url-has-credentials']);
  });

  test('refuses a missing or foreign version and an unknown key', () => {
    assert.deepEqual(codes({ url: DOC_URL }, 'example.com'), ['missing-version']);
    assert.deepEqual(codes({ v: 'agent9', url: DOC_URL }, 'example.com'), ['unsupported-version']);
    assert.deepEqual(codes(rec(DOC_URL, { foo: 'bar' }), 'example.com'), ['unknown-key']);
    assert.equal(validateRecord(rec(DOC_URL, { 'x-foo': 'bar' }), 'example.com').valid, true);
  });

  test('refuses a domain that is not a valid hostname', () => {
    assert.deepEqual(codes(rec(DOC_URL), 'not a host'), ['invalid-domain']);
    assert.deepEqual(codes(rec(DOC_URL), 'localhost'), ['invalid-domain']);
    assert.deepEqual(codes(rec(DOC_URL), '_agent.example.com'), ['invalid-domain']);
    assert.deepEqual(codes(rec(DOC_URL), '192.168.0.1'), ['invalid-domain']);
    assert.deepEqual(codes(rec(DOC_URL), 'bücher.example'), ['invalid-domain']);
    assert.deepEqual(codes(rec(DOC_URL), '-bad.example.com'), ['invalid-domain']);
  });

  test('refuses a non-object', () => {
    assert.deepEqual(codes(null, 'example.com'), ['not-an-object']);
    assert.deepEqual(codes(['v=agent1'], 'example.com'), ['not-an-object']);
  });
});

describe('hostnames', () => {
  test('isValidHostname follows RFC 1123 labels, two labels minimum, 253 chars', () => {
    assert.equal(isValidHostname('example.com'), true);
    assert.equal(isValidHostname('xn--bcher-kva.example'), true);
    assert.equal(isValidHostname('a.b.c.d.example.co.uk'), true);
    assert.equal(isValidHostname('example.com.'), true);
    assert.equal(isValidHostname('com'), false);
    assert.equal(isValidHostname(''), false);
    assert.equal(isValidHostname(`${'a'.repeat(64)}.com`), false);
    assert.equal(isValidHostname(`${'a.'.repeat(130)}com`), false);
    assert.equal(isValidHostname(undefined), false);
  });

  test('recordName prefixes _agent and normalises case and the trailing dot', () => {
    assert.equal(recordName('Example.COM.'), '_agent.example.com');
  });

  test('isSameDomain is the v1 rule: the host itself or a subdomain, never a parent or sibling', () => {
    assert.equal(isSameDomain('example.com', 'example.com'), true);
    assert.equal(isSameDomain('a.b.example.com', 'example.com'), true);
    assert.equal(isSameDomain('example.com', 'a.example.com'), false);
    assert.equal(isSameDomain('b.example.com', 'a.example.com'), false);
    assert.equal(isSameDomain('notexample.com', 'example.com'), false);
    assert.equal(isSameDomain('', 'example.com'), false);
  });
});

// ---------------------------------------------------------------------------

describe('selectRecord', () => {
  test('ignores records of other versions but refuses a record with no version at all', () => {
    assert.equal(selectRecord('example.com', ['v=agent2; url=https://example.com/x', GOOD]).state, 'ok');
    assert.deepEqual(selectRecord('example.com', ['v=agent2; url=https://example.com/x']), { state: 'absent', reason: 'no-v1-record' });
    assert.equal(selectRecord('example.com', ['hello world', GOOD]).state, 'invalid');
  });

  test('refuses more than one v=agent1 record even when both would be valid alone', () => {
    const r = selectRecord('example.com', [GOOD, GOOD]);
    assert.equal(r.state, 'invalid');
    assert.equal(r.reason, 'duplicate-records');
  });

  test('never reports unreachable — the records are already in hand', () => {
    for (const records of [[], [GOOD], ['junk'], [GOOD, GOOD]]) {
      assert.notEqual(selectRecord('example.com', records).state, 'unreachable');
    }
  });

  test('refuses a non-array', () => {
    assert.throws(() => selectRecord('example.com', GOOD), TypeError);
  });
});

// ---------------------------------------------------------------------------

describe('resolve', () => {
  const NAME = '_agent.example.com';
  const document = { contract: 'agent/1', org: 'org/example' };

  test('requires injected transports', async () => {
    await assert.rejects(() => resolve('example.com', {}), TypeError);
    await assert.rejects(() => resolve('example.com', { lookupTxt: async () => [] }), TypeError);
  });

  test('ok: record found, document fetched, parsed and returned', async () => {
    const t = transports({ txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: jsonResponse(document) } });
    const r = await resolve('example.com', t);
    assert.equal(r.state, 'ok');
    assert.equal(r.name, NAME);
    assert.equal(r.url, DOC_URL);
    assert.deepEqual(r.record, { v: 'agent1', url: DOC_URL });
    assert.deepEqual(r.document, document);
    assert.deepEqual(t.calls.lookups, [NAME]);
    assert.deepEqual(t.calls.fetches, [DOC_URL]);
  });

  test('ok: accepts a fetch-style Response with headers.get and text()', async () => {
    const res = { status: 200, headers: new Map([['content-type', 'application/json']]), text: async () => JSON.stringify(document) };
    const t = transports({ txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: res } });
    const r = await resolve('example.com', t);
    assert.equal(r.state, 'ok');
    assert.deepEqual(r.document, document);
  });

  test('absent: no TXT record at _agent.<domain>, and nothing is fetched', async () => {
    const t = transports();
    const r = await resolve('example.com', t);
    assert.equal(r.state, 'absent');
    assert.equal(r.reason, 'no-record');
    assert.deepEqual(t.calls.fetches, []);
  });

  test('absent: record ok but the document 404s (absent-document, with the url it tried)', async () => {
    const t = transports({ txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: { status: 404 } } });
    const r = await resolve('example.com', t);
    assert.equal(r.state, 'absent');
    assert.equal(r.reason, 'document-absent');
    assert.equal(r.url, DOC_URL);
    assert.equal(r.status, 404);
  });

  test('unreachable: the lookup throws', async () => {
    const e = Object.assign(new Error('query timed out'), { code: 'ETIMEOUT' });
    const t = transports({ txt: { [NAME]: e } });
    const r = await resolve('example.com', t);
    assert.equal(r.state, 'unreachable');
    assert.equal(r.reason, 'dns-failure');
    assert.match(r.error, /ETIMEOUT/);
    assert.deepEqual(t.calls.fetches, []);
  });

  test('unreachable: the fetch throws', async () => {
    const t = transports({ txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: new Error('ECONNRESET') } });
    const r = await resolve('example.com', t);
    assert.equal(r.state, 'unreachable');
    assert.equal(r.reason, 'fetch-failure');
    assert.equal(r.url, DOC_URL);
  });

  test('unreachable: the fetch times out under the resolver cap', async () => {
    const never = () => new Promise(() => {});
    const t = transports({ txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: never } });
    const r = await resolve('example.com', { ...t, timeoutMs: 20 });
    assert.equal(r.state, 'unreachable');
    assert.equal(r.reason, 'fetch-timeout');
  });

  test('unreachable: the lookup times out under the resolver cap', async () => {
    const r = await resolve('example.com', { lookupTxt: () => new Promise(() => {}), fetcher: async () => ({ status: 200 }), timeoutMs: 20 });
    assert.equal(r.state, 'unreachable');
    assert.equal(r.reason, 'dns-timeout');
  });

  test('unreachable: a 5xx from the document host is the server failing, not the agent missing', async () => {
    const t = transports({ txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: { status: 503 } } });
    const r = await resolve('example.com', t);
    assert.equal(r.state, 'unreachable');
    assert.equal(r.reason, 'document-server-error');
  });

  test('unreachable is never reported as absent', async () => {
    const failures = [
      { txt: { [NAME]: new Error('SERVFAIL') } },
      { txt: { [NAME]: Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }) } },
      { txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: new Error('ENOTFOUND') } },
      { txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: { status: 500 } } },
      { txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: { status: 502 } } },
      { txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: () => new Promise(() => {}) } },
    ];
    for (const f of failures) {
      const r = await resolve('example.com', { ...transports(f), timeoutMs: 20 });
      assert.equal(r.state, 'unreachable', JSON.stringify(f));
      assert.notEqual(r.state, 'absent');
    }
  });

  test('invalid: the record points cross-host, and the stranger is never fetched', async () => {
    const t = transports({ txt: { [NAME]: ['v=agent1; url=https://example.net/.well-known/agent'] } });
    const r = await resolve('example.com', t);
    assert.equal(r.state, 'invalid');
    assert.equal(r.reason, 'url-cross-host');
    assert.deepEqual(t.calls.fetches, []);
  });

  test('invalid: http url, duplicate records, unknown key, invalid domain', async () => {
    const cases = [
      [['v=agent1; url=http://example.com/a'], 'url-not-https'],
      [[GOOD, GOOD], 'duplicate-records'],
      [[`${GOOD}; capability=chat`], 'unknown-key'],
      [['url=https://example.com/a'], 'missing-version'],
    ];
    for (const [records, reason] of cases) {
      const t = transports({ txt: { [NAME]: records } });
      const r = await resolve('example.com', t);
      assert.equal(r.state, 'invalid', reason);
      assert.equal(r.reason, reason);
      assert.deepEqual(t.calls.fetches, []);
    }
    const t = transports();
    const r = await resolve('not a host', t);
    assert.equal(r.state, 'invalid');
    assert.equal(r.reason, 'invalid-domain');
    assert.deepEqual(t.calls.lookups, []);
  });

  test('follows exactly one redirect within the same domain', async () => {
    const moved = 'https://agents.example.com/.well-known/agent';
    const t = transports({
      txt: { [NAME]: [GOOD] },
      docs: { [DOC_URL]: { status: 302, headers: { Location: moved } }, [moved]: jsonResponse(document) },
    });
    const r = await resolve('example.com', t);
    assert.equal(r.state, 'ok');
    assert.equal(r.url, moved);
    assert.deepEqual(t.calls.fetches, [DOC_URL, moved]);
  });

  test('invalid: a redirect off the domain, to http, or a second redirect', async () => {
    const hop1 = 'https://example.com/a';
    const hop2 = 'https://example.com/b';
    const cases = [
      [{ [DOC_URL]: { status: 301, headers: { location: 'https://example.net/agent' } } }, 'redirect-cross-host'],
      [{ [DOC_URL]: { status: 301, headers: { location: 'http://example.com/agent' } } }, 'redirect-not-https'],
      [{ [DOC_URL]: { status: 301, headers: {} } }, 'redirect-missing-location'],
      [{ [DOC_URL]: { status: 301, headers: { location: hop1 } }, [hop1]: { status: 301, headers: { location: hop2 } } }, 'too-many-redirects'],
    ];
    for (const [docs, reason] of cases) {
      const t = transports({ txt: { [NAME]: [GOOD] }, docs });
      const r = await resolve('example.com', t);
      assert.equal(r.state, 'invalid', reason);
      assert.equal(r.reason, reason);
      assert.ok(!t.calls.fetches.some((u) => !u.startsWith('https://example.com') && !u.startsWith('https://agents.example.com')), 'no stranger fetched');
    }
  });

  test('invalid: an oversized, non-JSON or non-object document', async () => {
    const cases = [
      [{ status: 200, body: 'x'.repeat(DEFAULTS.maxBytes + 1) }, 'document-too-large', {}],
      [{ status: 200, headers: { 'content-length': String(DEFAULTS.maxBytes + 1) }, body: '{}' }, 'document-too-large', {}],
      [{ status: 200, body: '{"a":1}' }, 'document-too-large', { maxBytes: 4 }],
      [{ status: 200, body: 'not json' }, 'document-not-json', {}],
      [{ status: 200, body: '[1,2]' }, 'document-not-object', {}],
      [{ status: 200, body: 'null' }, 'document-not-object', {}],
      [{ status: 403 }, 'document-status-403', {}],
    ];
    for (const [res, reason, opts] of cases) {
      const t = transports({ txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: res } });
      const r = await resolve('example.com', { ...t, ...opts });
      assert.equal(r.state, 'invalid', reason);
      assert.equal(r.reason, reason);
    }
  });

  test('a fetcher that returns nothing usable is a programming error, not a finding', async () => {
    const t = transports({ txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: { nope: true } } });
    await assert.rejects(() => resolve('example.com', t), TypeError);
    await assert.rejects(() => resolve('example.com', { lookupTxt: async () => 'v=agent1', fetcher: async () => ({ status: 200 }) }), TypeError);
  });

  test('every finding is one of the four states', async () => {
    const runs = [
      transports(),
      transports({ txt: { [NAME]: [GOOD] }, docs: { [DOC_URL]: jsonResponse(document) } }),
      transports({ txt: { [NAME]: new Error('x') } }),
      transports({ txt: { [NAME]: ['junk'] } }),
    ];
    for (const t of runs) assert.ok(STATES.includes((await resolve('example.com', t)).state));
  });
});

// ---------------------------------------------------------------------------

describe('cli', () => {
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8' });

  test('parse prints the record and exits 0 when valid', () => {
    const r = run('parse', GOOD);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.valid, true);
    assert.equal(out.contract, CONTRACT);
    assert.deepEqual(out.record, { v: 'agent1', url: DOC_URL });
  });

  test('parse with a domain also validates and exits 1 on a cross-host url', () => {
    assert.equal(run('parse', GOOD, 'example.com').status, 0);
    const r = run('parse', GOOD, 'example.net');
    assert.equal(r.status, 1);
    assert.deepEqual(JSON.parse(r.stdout).errors.map((e) => e.code), ['url-cross-host']);
  });

  test('parse exits 1 on a malformed record', () => {
    const r = run('parse', 'url=https://example.com/a');
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).valid, false);
  });

  test('check passes every shipped vector', () => {
    const r = run('check', VECTORS_DIR);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!/FAIL/.test(r.stdout));
    assert.equal(r.stdout.trim().split('\n').length, loadVectors().length);
  });

  test('check exits 1 on a vector whose expectation is wrong, and names the mismatch', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agent-dns-'));
    const bad = join(dir, 'wrong.json');
    writeFileSync(bad, JSON.stringify({ domain: 'example.com', records: [GOOD], expect: { state: 'absent' } }));
    const r = run('check', bad);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /FAIL .*state: expected "absent", got "ok"/);
    const unparseable = join(dir, 'broken.json');
    writeFileSync(unparseable, '{');
    assert.equal(run('check', unparseable).status, 1);
  });

  test('no command or an unknown command prints usage and exits 2', () => {
    assert.equal(run().status, 2);
    assert.equal(run('resolve', 'example.com').status, 2);
    assert.equal(run('check').status, 2);
    assert.match(run().stderr, /usage/);
  });
});

// ---------------------------------------------------------------------------

describe('repository', () => {
  test('README ends on the estate licence line and never claims adoption', () => {
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const last = readme.trimEnd().split('\n').pop();
    assert.equal(last, 'Licensed under Apache-2.0 (holder Flashy Labs); the estate register in flashyos `tools/estate-licences.mjs` is the authority.');
    assert.match(readme, /Status: draft/);
    assert.doesNotMatch(readme, /\b(adopted by|used by|trusted by)\b/i);
  });

  test('the LICENSE carries the Apache-2.0 text with the estate copyright holder', () => {
    const licensePath = join(ROOT, 'LICENSE');
    assert.ok(existsSync(licensePath), 'LICENSE is missing — the estate register names this repository Apache-2.0');
    const licence = readFileSync(licensePath, 'utf8');
    assert.match(licence, /Apache License/, 'LICENSE must contain "Apache License"');
    assert.match(licence, /Copyright 2026 Flashy Labs/, 'LICENSE must name "Copyright 2026 Flashy Labs"');
  });

  test('SPEC is a draft of agent-dns/1 and names the four findings', () => {
    const spec = readFileSync(join(ROOT, 'SPEC.md'), 'utf8');
    assert.match(spec, /Status: draft/);
    assert.match(spec, /`agent-dns\/1`/);
    for (const s of STATES) assert.match(spec, new RegExp(`\`${s}\``));
  });

  test('package.json declares no dependencies and Node 22', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    assert.equal(pkg.type, 'module');
    assert.equal(pkg.private, true);
    assert.equal(pkg.dependencies, undefined);
    assert.equal(pkg.devDependencies, undefined);
    assert.equal(pkg.engines.node, '>=22');
  });

  test('the resolver imports node: builtins and its one sibling, vendor-domain.mjs, and nothing else', () => {
    const src = readFileSync(CLI, 'utf8');
    const specifiers = [...src.matchAll(/^(?:import|export)\b[^'"\n]*?from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1]);
    for (const s of specifiers) {
      assert.ok(s.startsWith('node:') || s === './vendor-domain.mjs', s);
    }
    assert.ok(specifiers.includes('./vendor-domain.mjs'), 'the domain rule is imported, not restated');
    assert.doesNotMatch(src, /^export function (isSameDomain|normalizeDomain)\b/m, 'the domain rule is defined once, in vendor-domain.mjs');
  });

  test('vendor-domain.mjs imports nothing at all — it must run in a pure module and a browser', () => {
    const src = readFileSync(join(ROOT, 'vendor-domain.mjs'), 'utf8');
    assert.doesNotMatch(src, /^\s*import\b/m);
    assert.doesNotMatch(src, /\brequire\s*\(/);
  });
});
