#!/usr/bin/env node
// agent-dns/1 — reference parser, validator and resolver.
//
// One TXT record at `_agent.<domain>` points at the domain's agent/1 discovery
// document. This file parses the record, validates it against the domain it
// was found under, and resolves a domain to one of four findings that are
// never collapsed into each other: ok, absent, unreachable, invalid.
//
// Dependency-free: node: builtins only. No live DNS or network happens here —
// the resolver takes an injected `lookupTxt` and an injected `fetcher`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTRACT = 'agent-dns/1';
export const VERSION_TOKEN = 'agent1';
export const RECORD_LABEL = '_agent';
export const KNOWN_KEYS = Object.freeze(['v', 'url', 'org']);
export const STATES = Object.freeze(['ok', 'absent', 'unreachable', 'invalid']);
export const DEFAULTS = Object.freeze({
  timeoutMs: 5000, // per network operation (one lookup, one fetch hop)
  maxBytes: 65536, // discovery document size cap
  maxRedirects: 1, // one redirect, https, same domain
});

const KEY_RE = /^[a-z][a-z0-9-]*$/;
const EXTENSION_KEY_RE = /^x-[a-z0-9][a-z0-9-]*$/;
const VALUE_RE = /^[\x21-\x3a\x3c-\x7e]+$/; // visible ASCII, no ";" and no whitespace
const LABEL_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const ORG_RE = /^org\/[a-z0-9][a-z0-9-]*$/;
const V1_PREFIX_RE = /^v=agent1\s*(?:;|$)/;
const ANY_VERSION_PREFIX_RE = /^v=[^;\s]+\s*(?:;|$)/;

function err(code, message) {
  return { code, message };
}

function messageOf(e) {
  if (e && typeof e === 'object') {
    const code = typeof e.code === 'string' ? `${e.code}: ` : '';
    return `${code}${e.message ?? String(e)}`;
  }
  return String(e);
}

// ---------------------------------------------------------------------------
// Hostnames

export function normalizeDomain(input) {
  if (typeof input !== 'string') return null;
  let d = input.trim().toLowerCase();
  if (d.endsWith('.')) d = d.slice(0, -1);
  return d;
}

/**
 * A valid hostname for agent-dns/1: ASCII (IDNA-encode first), at least two
 * labels, RFC 1123 label rules, 253 characters or fewer, not an IPv4 literal.
 * Underscores are refused, so `_agent.example.com` is not itself a domain.
 */
export function isValidHostname(input) {
  const d = normalizeDomain(input);
  if (!d || d.length > 253) return false;
  const labels = d.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((label) => LABEL_RE.test(label))) return false;
  if (/^[0-9]+$/.test(labels[labels.length - 1])) return false;
  return true;
}

/** The DNS name queried for `<domain>`: `_agent.<domain>`. */
export function recordName(domain) {
  return `${RECORD_LABEL}.${normalizeDomain(domain)}`;
}

/**
 * The same-domain rule of version 1: `host` is `domain` itself or a subdomain
 * of it. This is deliberately narrower than "same registrable domain": without
 * a Public Suffix List the resolver cannot tell `co.uk` from `example.com`, and
 * guessing would let `a.co.uk` point at `b.co.uk`. A parent or sibling host is
 * refused; the record's owner can always publish under the domain it names.
 */
export function isSameDomain(host, domain) {
  const h = normalizeDomain(host);
  const d = normalizeDomain(domain);
  if (!h || !d) return false;
  return h === d || h.endsWith(`.${d}`);
}

// ---------------------------------------------------------------------------
// Record grammar

/**
 * Parse one TXT record string into a record object.
 *
 *   record = pair *( ";" *SP pair ) [ ";" ]
 *   pair   = key "=" value
 *   key    = LALPHA *( LALPHA / DIGIT / "-" )
 *   value  = 1*( %x21-3A / %x3C-7E )        ; visible ASCII except ";"
 *
 * The first pair MUST be `v=agent1`. `url` is required. `org` is optional and
 * must be `org/<slug>`. Any other key must start with `x-`. Keys may not repeat.
 *
 * Returns { valid, record, errors } — errors is an array of { code, message }.
 * The record is returned even when invalid so a caller can show what was read.
 */
export function parseRecord(txt) {
  if (typeof txt !== 'string') {
    return { valid: false, errors: [err('not-a-string', 'a TXT record is a string')] };
  }
  const trimmed = txt.trim();
  if (trimmed === '') {
    return { valid: false, record: {}, errors: [err('empty-record', 'the record is empty')] };
  }

  const errors = [];
  const record = {};
  const parts = trimmed.split(';');
  if (parts.length > 1 && parts[parts.length - 1].trim() === '') parts.pop(); // one trailing ";" is allowed

  let firstKey = null;
  parts.forEach((part, index) => {
    const pair = part.trim();
    if (pair === '') {
      errors.push(err('empty-pair', `pair ${index + 1} is empty`));
      return;
    }
    const eq = pair.indexOf('=');
    if (eq < 1) {
      errors.push(err('malformed-pair', `pair ${index + 1} is not key=value: ${JSON.stringify(pair)}`));
      return;
    }
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (index === 0) firstKey = key;
    if (!KEY_RE.test(key)) {
      errors.push(err('invalid-key', `key ${JSON.stringify(key)} is not lowercase [a-z0-9-] starting with a letter`));
      return;
    }
    if (!VALUE_RE.test(value)) {
      errors.push(err('invalid-value', `value of ${key} must be non-empty visible ASCII with no ";" or whitespace`));
      return;
    }
    if (Object.hasOwn(record, key)) {
      errors.push(err('duplicate-key', `key ${key} appears more than once`));
      return;
    }
    if (!KNOWN_KEYS.includes(key) && !EXTENSION_KEY_RE.test(key)) {
      errors.push(err('unknown-key', `key ${key} is not known to ${CONTRACT} and is not an x- extension`));
    }
    record[key] = value;
  });

  if (!Object.hasOwn(record, 'v')) {
    errors.push(err('missing-version', 'the record does not carry v=agent1'));
  } else {
    if (firstKey !== 'v') errors.push(err('version-not-first', 'v=agent1 must be the first pair'));
    if (record.v !== VERSION_TOKEN) {
      errors.push(err('unsupported-version', `v=${record.v} is not ${VERSION_TOKEN}`));
    }
  }
  if (!Object.hasOwn(record, 'url')) {
    errors.push(err('missing-url', 'the record does not carry a url'));
  }
  if (Object.hasOwn(record, 'org') && !ORG_RE.test(record.org)) {
    errors.push(err('invalid-org', 'org must be org/<slug> with slug [a-z0-9][a-z0-9-]*'));
  }

  return { valid: errors.length === 0, record, errors };
}

/**
 * Validate a parsed record against the domain it was found under.
 * Returns { valid, errors }.
 */
export function validateRecord(record, domain) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, errors: [err('not-an-object', 'a record is a plain object')] };
  }
  const errors = [];
  const domainOk = isValidHostname(domain);
  if (!domainOk) errors.push(err('invalid-domain', `${JSON.stringify(String(domain))} is not a valid hostname`));

  if (!Object.hasOwn(record, 'v')) {
    errors.push(err('missing-version', 'the record does not carry v=agent1'));
  } else if (record.v !== VERSION_TOKEN) {
    errors.push(err('unsupported-version', `v=${record.v} is not ${VERSION_TOKEN}`));
  }

  if (typeof record.url !== 'string' || record.url === '') {
    errors.push(err('missing-url', 'the record does not carry a url'));
  } else {
    let u = null;
    try {
      u = new URL(record.url);
    } catch {
      errors.push(err('url-unparseable', `url ${JSON.stringify(record.url)} does not parse`));
    }
    if (u) {
      if (u.protocol !== 'https:') errors.push(err('url-not-https', 'url must be https'));
      if (u.username || u.password) errors.push(err('url-has-credentials', 'url must not carry credentials'));
      if (domainOk && !isSameDomain(u.hostname, domain)) {
        errors.push(err('url-cross-host', `url host ${u.hostname} is not ${normalizeDomain(domain)} or a subdomain of it`));
      }
    }
  }

  if (Object.hasOwn(record, 'org') && !ORG_RE.test(String(record.org))) {
    errors.push(err('invalid-org', 'org must be org/<slug> with slug [a-z0-9][a-z0-9-]*'));
  }

  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.includes(key) && !EXTENSION_KEY_RE.test(key)) {
      errors.push(err('unknown-key', `key ${key} is not known to ${CONTRACT} and is not an x- extension`));
    }
    if (typeof record[key] !== 'string') {
      errors.push(err('invalid-value', `value of ${key} must be a string`));
    }
  }

  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Selection — the DNS half of resolution, pure and synchronous

/**
 * Given the TXT records found at `_agent.<domain>`, select the one agent
 * record or refuse. Returns { state: ok|absent|invalid, ... } — never
 * `unreachable`, because the records are already in hand.
 *
 * - A record whose first pair is `v=agent1` is a candidate.
 * - A record whose first pair is `v=<other>` is another version and is ignored.
 * - Any other record at this name is malformed: `invalid`.
 * - More than one candidate: `invalid` (duplicate-records). Ambiguity is refused.
 * - No candidate: `absent`.
 */
export function selectRecord(domain, records) {
  if (!isValidHostname(domain)) {
    return { state: 'invalid', reason: 'invalid-domain', errors: [err('invalid-domain', `${JSON.stringify(String(domain))} is not a valid hostname`)] };
  }
  if (!Array.isArray(records)) throw new TypeError('records must be an array of TXT strings');

  const candidates = [];
  let otherVersions = 0;
  for (const raw of records) {
    const txt = String(raw).trim();
    if (V1_PREFIX_RE.test(txt)) {
      candidates.push(txt);
    } else if (ANY_VERSION_PREFIX_RE.test(txt)) {
      otherVersions += 1;
    } else {
      const parsed = parseRecord(txt);
      const first = parsed.errors[0] ?? err('malformed-record', 'record at _agent name is not an agent record');
      return { state: 'invalid', reason: first.code, errors: parsed.errors, txt };
    }
  }

  if (candidates.length > 1) {
    return {
      state: 'invalid',
      reason: 'duplicate-records',
      errors: [err('duplicate-records', `${candidates.length} v=agent1 records at ${recordName(domain)}; exactly one is allowed`)],
    };
  }
  if (candidates.length === 0) {
    return { state: 'absent', reason: otherVersions > 0 ? 'no-v1-record' : 'no-record' };
  }

  const txt = candidates[0];
  const parsed = parseRecord(txt);
  if (!parsed.valid) {
    return { state: 'invalid', reason: parsed.errors[0].code, errors: parsed.errors, record: parsed.record, txt };
  }
  const validated = validateRecord(parsed.record, domain);
  if (!validated.valid) {
    return { state: 'invalid', reason: validated.errors[0].code, errors: validated.errors, record: parsed.record, txt };
  }
  return { state: 'ok', url: parsed.record.url, record: parsed.record, txt };
}

// ---------------------------------------------------------------------------
// Resolution — DNS then fetch, with injected transports

class TimeoutError extends Error {
  constructor(ms) {
    super(`timed out after ${ms}ms`);
    this.name = 'TimeoutError';
    this.code = 'TIMEOUT';
  }
}

function withTimeout(start, ms) {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(ms));
    }, ms);
  });
  return Promise.race([Promise.resolve().then(() => start(controller.signal)), timeout]).finally(() => clearTimeout(timer));
}

function headerOf(res, name) {
  const headers = res.headers;
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const wanted = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === wanted) return Array.isArray(v) ? v[0] : v;
  }
  return null;
}

async function bodyOf(res) {
  if (typeof res.text === 'function') return await res.text();
  if (typeof res.body === 'string') return res.body;
  if (res.body instanceof Uint8Array) return new TextDecoder().decode(res.body);
  if (res.body === undefined || res.body === null) return '';
  throw new TypeError('fetcher response body must be a string, a Uint8Array, or readable via text()');
}

async function fetchDocument(url, domain, { fetcher, timeoutMs, maxBytes, maxRedirects }) {
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    let res;
    try {
      res = await withTimeout((signal) => fetcher(current, { signal, redirect: 'manual' }), timeoutMs);
    } catch (e) {
      const reason = e instanceof TimeoutError ? 'fetch-timeout' : 'fetch-failure';
      return { state: 'unreachable', reason, url: current, error: messageOf(e) };
    }
    if (!res || typeof res.status !== 'number') {
      throw new TypeError('fetcher must resolve to an object with a numeric status');
    }
    const { status } = res;

    if (status >= 300 && status < 400) {
      if (hop >= maxRedirects) {
        return { state: 'invalid', reason: 'too-many-redirects', url: current, status };
      }
      const location = headerOf(res, 'location');
      if (!location) return { state: 'invalid', reason: 'redirect-missing-location', url: current, status };
      let next;
      try {
        next = new URL(location, current);
      } catch {
        return { state: 'invalid', reason: 'redirect-unparseable', url: current, status, location };
      }
      if (next.protocol !== 'https:') {
        return { state: 'invalid', reason: 'redirect-not-https', url: current, status, location: next.href };
      }
      if (!isSameDomain(next.hostname, domain)) {
        return { state: 'invalid', reason: 'redirect-cross-host', url: current, status, location: next.href };
      }
      current = next.href;
      continue;
    }

    if (status === 404 || status === 410) {
      return { state: 'absent', reason: 'document-absent', url: current, status };
    }
    if (status >= 500) {
      return { state: 'unreachable', reason: 'document-server-error', url: current, status };
    }
    if (status < 200 || status >= 300) {
      return { state: 'invalid', reason: `document-status-${status}`, url: current, status };
    }

    const declared = Number(headerOf(res, 'content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      return { state: 'invalid', reason: 'document-too-large', url: current, status, bytes: declared, maxBytes };
    }
    let text;
    try {
      text = await withTimeout(() => bodyOf(res), timeoutMs);
    } catch (e) {
      if (e instanceof TypeError) throw e;
      const reason = e instanceof TimeoutError ? 'fetch-timeout' : 'fetch-failure';
      return { state: 'unreachable', reason, url: current, error: messageOf(e) };
    }
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > maxBytes) {
      return { state: 'invalid', reason: 'document-too-large', url: current, status, bytes, maxBytes };
    }
    let document;
    try {
      document = JSON.parse(text);
    } catch {
      return { state: 'invalid', reason: 'document-not-json', url: current, status, bytes };
    }
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      return { state: 'invalid', reason: 'document-not-object', url: current, status, bytes };
    }
    return { state: 'ok', url: current, status, bytes, document };
  }
  // Unreachable by construction: the loop returns on every path.
  throw new Error('fetchDocument fell through');
}

/**
 * Resolve `domain` to its agent/1 discovery document.
 *
 * options.lookupTxt(name, { signal }) → Promise<string[]>
 *   Resolves to the TXT records at `name`, each record's character-strings
 *   already joined. Resolves to [] when the name has no TXT records (NXDOMAIN
 *   or NODATA). Throws when no answer could be obtained.
 * options.fetcher(url, { signal, redirect: 'manual' }) → Promise<Response-like>
 *   Resolves to { status, headers?, body? | text() }. Must NOT follow redirects
 *   itself; the resolver follows at most one, https, same domain.
 *
 * Returns one of:
 *   { state: 'ok',          name, url, record, document, status, bytes }
 *   { state: 'absent',      name, reason, url? }        no record, or the document 404s
 *   { state: 'unreachable', name, reason, error? }      DNS or fetch failed — a fact about this resolver
 *   { state: 'invalid',     name?, reason, errors? }    malformed, cross-host, non-https, ambiguous
 */
export async function resolve(domain, options = {}) {
  const { lookupTxt, fetcher } = options;
  if (typeof lookupTxt !== 'function') throw new TypeError('resolve requires options.lookupTxt(name) → Promise<string[]>');
  if (typeof fetcher !== 'function') throw new TypeError('resolve requires options.fetcher(url) → Promise<Response-like>');
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const maxBytes = options.maxBytes ?? DEFAULTS.maxBytes;
  const maxRedirects = options.maxRedirects ?? DEFAULTS.maxRedirects;

  if (!isValidHostname(domain)) {
    return {
      state: 'invalid',
      reason: 'invalid-domain',
      errors: [err('invalid-domain', `${JSON.stringify(String(domain))} is not a valid hostname`)],
    };
  }
  const d = normalizeDomain(domain);
  const name = recordName(d);

  let records;
  try {
    records = await withTimeout((signal) => lookupTxt(name, { signal }), timeoutMs);
  } catch (e) {
    const reason = e instanceof TimeoutError ? 'dns-timeout' : 'dns-failure';
    return { state: 'unreachable', name, reason, error: messageOf(e) };
  }
  if (!Array.isArray(records)) throw new TypeError('lookupTxt must resolve to an array of strings');

  const selected = selectRecord(d, records);
  if (selected.state !== 'ok') return { name, ...selected };

  const fetched = await fetchDocument(selected.url, d, { fetcher, timeoutMs, maxBytes, maxRedirects });
  return { name, record: selected.record, ...fetched };
}

// ---------------------------------------------------------------------------
// Vectors — {domain, records: [txt...], expect: {state, reason?, url?, record?}}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Run one vector through selectRecord and compare every key `expect` names.
 * Returns { pass, actual, expect, mismatches: [{key, expected, actual}] }.
 */
export function checkVector(vector) {
  if (!vector || typeof vector !== 'object') throw new TypeError('a vector is an object');
  if (!Array.isArray(vector.records)) throw new TypeError('vector.records must be an array of TXT strings');
  if (!vector.expect || typeof vector.expect.state !== 'string') throw new TypeError('vector.expect.state is required');
  if (!STATES.includes(vector.expect.state)) throw new TypeError(`vector.expect.state must be one of ${STATES.join('|')}`);
  const actual = selectRecord(vector.domain, vector.records);
  const mismatches = [];
  for (const [key, expected] of Object.entries(vector.expect)) {
    if (!deepEqual(actual[key], expected)) mismatches.push({ key, expected, actual: actual[key] });
  }
  return { pass: mismatches.length === 0, actual, expect: vector.expect, mismatches };
}

function listVectorFiles(paths) {
  const files = [];
  for (const p of paths) {
    const abs = resolvePath(p);
    if (statSync(abs).isDirectory()) {
      for (const f of readdirSync(abs).sort()) if (f.endsWith('.json')) files.push(join(abs, f));
    } else {
      files.push(abs);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// CLI

const USAGE = `usage:
  node vendor-agent-dns.mjs parse "<txt>" [<domain>]   parse a record (and validate it against <domain>)
  node vendor-agent-dns.mjs check <vector.json|dir>...  run vectors; exit 1 on any failure`;

export function main(argv, io = { stdout: process.stdout, stderr: process.stderr }) {
  const [command, ...rest] = argv;
  const out = (s) => io.stdout.write(`${s}\n`);
  const errOut = (s) => io.stderr.write(`${s}\n`);

  if (command === 'parse') {
    const [txt, domain] = rest;
    if (typeof txt !== 'string') {
      errOut(USAGE);
      return 2;
    }
    const parsed = parseRecord(txt);
    const result = { contract: CONTRACT, ...parsed };
    if (domain !== undefined) {
      const validated = parsed.record ? validateRecord(parsed.record, domain) : { valid: false, errors: [] };
      result.domain = domain;
      result.valid = parsed.valid && validated.valid;
      result.errors = [...parsed.errors, ...validated.errors.filter((e) => !parsed.errors.some((p) => p.code === e.code))];
    }
    out(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }

  if (command === 'check') {
    if (rest.length === 0) {
      errOut(USAGE);
      return 2;
    }
    let failures = 0;
    for (const file of listVectorFiles(rest)) {
      let vector;
      try {
        vector = JSON.parse(readFileSync(file, 'utf8'));
      } catch (e) {
        failures += 1;
        out(`FAIL ${file}: ${messageOf(e)}`);
        continue;
      }
      let result;
      try {
        result = checkVector(vector);
      } catch (e) {
        failures += 1;
        out(`FAIL ${file}: ${messageOf(e)}`);
        continue;
      }
      if (result.pass) {
        out(`PASS ${file} (${result.actual.state}${result.actual.reason ? `: ${result.actual.reason}` : ''})`);
      } else {
        failures += 1;
        const detail = result.mismatches
          .map((m) => `${m.key}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`)
          .join('; ');
        out(`FAIL ${file}: ${detail}`);
      }
    }
    return failures === 0 ? 0 : 1;
  }

  errOut(USAGE);
  return 2;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === resolvePath(process.argv[1]);
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
