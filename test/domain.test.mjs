// The same-domain rule, pinned case by case. This file is the canonical
// statement of what `vendor-domain.mjs` does; the copies in agent-wellknown,
// bastion and flashy-examples are compared to it byte for byte, so a case
// that passes here passes everywhere the rule is applied.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isSameDomain, normalizeDomain, sameDomainUrl } from '../vendor-domain.mjs';

describe('normalizeDomain', () => {
  test('lowercases, trims and strips one trailing dot; null for a non-string', () => {
    assert.equal(normalizeDomain('  Example.COM. '), 'example.com');
    assert.equal(normalizeDomain('example.com'), 'example.com');
    assert.equal(normalizeDomain(''), '');
    assert.equal(normalizeDomain(undefined), null);
    assert.equal(normalizeDomain(42), null);
  });
});

describe('isSameDomain', () => {
  test('equal host', () => {
    assert.equal(isSameDomain('example.com', 'example.com'), true);
  });

  test('subdomain', () => {
    assert.equal(isSameDomain('api.example.com', 'example.com'), true);
  });

  test('deeper subdomain', () => {
    assert.equal(isSameDomain('a.b.c.example.com', 'example.com'), true);
  });

  test('parent refused', () => {
    assert.equal(isSameDomain('example.com', 'shop.example.com'), false);
  });

  test('sibling refused', () => {
    assert.equal(isSameDomain('b.example.com', 'a.example.com'), false);
  });

  test('acme.co.uk and www.acme.co.uk are the same domain', () => {
    assert.equal(isSameDomain('www.acme.co.uk', 'acme.co.uk'), true);
  });

  test('acme.co.uk and other.co.uk are NOT the same domain — the rule does not guess at a suffix', () => {
    assert.equal(isSameDomain('other.co.uk', 'acme.co.uk'), false);
    assert.equal(isSameDomain('acme.co.uk', 'other.co.uk'), false);
    // The bare suffix is a parent of both, and a parent is refused too.
    assert.equal(isSameDomain('co.uk', 'acme.co.uk'), false);
  });

  test('a lookalike whose suffix merely ends with the domain is refused', () => {
    assert.equal(isSameDomain('notexample.com', 'example.com'), false);
    assert.equal(isSameDomain('example.com.evil.example', 'example.com'), false);
  });

  test('case-insensitive', () => {
    assert.equal(isSameDomain('API.Example.COM', 'example.com'), true);
    assert.equal(isSameDomain('example.com', 'EXAMPLE.COM'), true);
  });

  test('trailing dot', () => {
    assert.equal(isSameDomain('example.com.', 'example.com'), true);
    assert.equal(isSameDomain('api.example.com', 'example.com.'), true);
  });

  test('empty or non-string input is never the same domain as anything', () => {
    assert.equal(isSameDomain('', 'example.com'), false);
    assert.equal(isSameDomain('example.com', ''), false);
    assert.equal(isSameDomain(undefined, 'example.com'), false);
    assert.equal(isSameDomain('example.com', null), false);
  });
});

describe('sameDomainUrl', () => {
  test('same host, subdomain and country-suffix subdomain are followed', () => {
    assert.equal(sameDomainUrl('https://example.com/a', 'https://example.com/b'), true);
    assert.equal(sameDomainUrl('https://example.com/a', 'https://www.example.com/b'), true);
    assert.equal(sameDomainUrl('https://acme.co.uk/a', 'https://www.acme.co.uk/b'), true);
    assert.equal(sameDomainUrl('https://example.com/a', 'https://EXAMPLE.com./b'), true);
  });

  test('parent, sibling, stranger and co.uk neighbour are refused', () => {
    assert.equal(sameDomainUrl('https://www.example.com/a', 'https://example.com/b'), false);
    assert.equal(sameDomainUrl('https://a.example.com/a', 'https://b.example.com/b'), false);
    assert.equal(sameDomainUrl('https://example.com/a', 'https://example.net/b'), false);
    assert.equal(sameDomainUrl('https://acme.co.uk/a', 'https://other.co.uk/b'), false);
  });

  test('non-https refused, in either position', () => {
    assert.equal(sameDomainUrl('https://example.com/a', 'http://example.com/b'), false);
    assert.equal(sameDomainUrl('http://example.com/a', 'https://example.com/b'), false);
    assert.equal(sameDomainUrl('https://example.com/a', 'ftp://example.com/b'), false);
  });

  test('unparsable refused, in either position', () => {
    assert.equal(sameDomainUrl('https://example.com/a', '/relative'), false);
    assert.equal(sameDomainUrl('https://example.com/a', 'https://[::1'), false);
    assert.equal(sameDomainUrl('not a url', 'https://example.com/b'), false);
    assert.equal(sameDomainUrl(undefined, 'https://example.com/b'), false);
    assert.equal(sameDomainUrl('https://example.com/a', ''), false);
  });

  test('a port is not the rule\'s business — it compares hosts only', () => {
    assert.equal(sameDomainUrl('https://example.com/a', 'https://example.com:8443/b'), true);
  });
});
