# agent-dns

<img src="brand/assets/bolt-gold.svg" width="48" alt="">

`agent-dns/1` is a vendor-neutral way for a domain to say where its agents are described — one DNS TXT record at `_agent.<domain>` pointing at the domain's `agent/1` discovery document — for anyone building or consuming agents who needs to get from a domain name to an organisation, its agents and their capabilities without asking a directory first.

DNS bootstrapped the web by turning a name into an address. `agent-dns/1` does the same for the agentic internet: the name is the domain, the address is one https URL, and everything else lives in the document that URL serves. The document format is a sibling specification, `agent/1`, and is not redefined here.

Status: draft. Nothing here is deployed, adopted or measured; the vectors and tests are the whole of the evidence.

## Quick start

No install. Node 22.

```bash
node vendor-agent-dns.mjs parse "v=agent1; url=https://example.com/.well-known/agent" example.com
node vendor-agent-dns.mjs check vectors/invalid-cross-host-url.json
npm test
```

The first prints the parsed record as JSON and exits 0; with a domain given it also validates the url against that domain. The second runs one vector and prints `PASS vectors/invalid-cross-host-url.json (invalid: url-cross-host)`. The third runs the suite with `node --test`.

Resolving a real domain is the same function with real transports, which this repository deliberately does not ship — the tests use in-memory maps and nothing here touches the network. A consumer wires Node's own resolver and `fetch`:

```js
import { resolveTxt } from 'node:dns/promises';
import { resolve } from './vendor-agent-dns.mjs';

const lookupTxt = async (name) => {
  try {
    return (await resolveTxt(name)).map((chunks) => chunks.join(''));
  } catch (e) {
    if (e.code === 'ENOTFOUND' || e.code === 'ENODATA') return []; // no record is a finding, not a failure
    throw e; // anything else is unreachable
  }
};
const fetcher = (url, { signal }) => fetch(url, { signal, redirect: 'manual' });

const finding = await resolve('example.com', { lookupTxt, fetcher });
// finding.state is one of 'ok' | 'absent' | 'unreachable' | 'invalid'
```

That snippet is not exercised by the tests, because they have no network; the contract it satisfies (`lookupTxt` resolves `[]` for no record and throws for no answer; the fetcher never follows redirects itself) is in `SPEC.md`.

## What makes it different

**One record.** A domain has exactly one `v=agent1` record at `_agent.<domain>`. Two is refused as `duplicate-records` — ambiguity is refused, never resolved by picking the first. Records of other versions at the same name are ignored, so a future `agent2` can coexist with this one.

**One url.** The record carries a version, a url, an optional `org`, and nothing else. No capabilities, no keys, no endpoints in DNS. DNS points; the document describes.

**Same domain only.** The url must be https and its host must be `<domain>` or a subdomain of it. A record may not point a domain at another company's document. Version 1 carries no Public Suffix List, so it does not try to compute "registrable domain" and guess whether `co.uk` is a suffix; it refuses parents and siblings as well as strangers. The narrower rule costs nothing a publisher cannot fix by publishing under the domain the url names.

## The domain rule is canonical here

`vendor-domain.mjs` is the whole of the same-domain rule — `normalizeDomain(host)`, `isSameDomain(host, domain)` and `sameDomainUrl(fromUrl, toUrl)` — with no imports at all, and `test/domain.test.mjs` pins it case by case. It is canonical in this repository and vendored **byte-identically** into `agent-wellknown`, `bastion` and `flashy-examples`, each of which carries a drift test against this copy. Re-vendor; never edit the copies.

It exists because the estate had three implementations of "same domain" in specifications built to interoperate, and two of them sliced the last two labels of a hostname — a rule that reads `acme.co.uk` and `other.co.uk` as one publisher. The rule kept is this one: host equals `<domain>` or is a subdomain of it, case-insensitive, trailing dot ignored, and no guessing at suffixes. The one well-known path the document lives at is `/.well-known/agent`, and only that.

**Four findings, never collapsed.** A resolver reports `ok`, `absent`, `unreachable` or `invalid`, and a consumer can tell them apart every time. `unreachable` is a fact about the resolver's connectivity and is never evidence that the domain has no agent; a test enumerates six failure shapes and asserts none of them reads `absent`.

**Null is never zero.** A lookup that throws, a fetch that times out, a 5xx from the document host — each is `unreachable` with a reason, not an empty result. The only thing that reads `absent` is an actual answer saying there is nothing there: no TXT record, or a 404/410 for the document.

**Refuse, don't guess.** Non-https url, cross-host url, missing `v=agent1`, missing `url`, a key the contract does not name (unless `x-` prefixed), a repeated key, more than one record, a `<domain>` that is not a hostname — each is `invalid` with a stable reason code, and each has a vector.

## Layout

| Path | What it is |
|---|---|
| `SPEC.md` | The specification: grammar, resolution algorithm, findings, refusals, security considerations, what v1 does not carry |
| `schema/agent-dns-1.json` | JSON Schema (draft 2020-12) for the parsed record object |
| `vendor-agent-dns.mjs` | Reference implementation and CLI: `parseRecord`, `validateRecord`, `selectRecord`, `resolve`, `checkVector`; `node:` builtins plus `./vendor-domain.mjs`, nothing else |
| `vendor-domain.mjs` | The same-domain rule, canonical here and vendored byte-identically elsewhere: `normalizeDomain`, `isSameDomain`, `sameDomainUrl`; no imports at all |
| `vectors/` | Twenty test vectors, `{contract, domain, records, expect}` — five valid, two absent, thirteen invalid |
| `test/agent-dns.test.mjs` | `node --test` suite: vectors, parser, validator, resolver with injected transports, CLI, repository rules |
| `test/domain.test.mjs` | The same-domain rule pinned case by case: equal, subdomain, parent, sibling, `co.uk` neighbours, case, trailing dot, non-https, unparsable |
| `tools/lint.mjs` | Zero-install lint: `node --check` on every `.mjs`, `node:`-only imports, no dependencies, the Apache-2.0 `LICENSE`, licence line, credential shapes |
| `CLAUDE.md` | Working notes for agents and people: what is different here and which rules a test holds |

## Links

Sibling specifications, referenced by name and not redefined here:

- `agent/1` — the discovery document this record points at (the `agent-wellknown` repository)
- `intent/1` — how a consumer states what it wants once it has found an agent
- `ritual/1` — the interaction contract an agent and a consumer settle on
- `aao/0.1` — the organisation charter an `org/<slug>` in a record refers to
- `delegation/1` — how authority is attenuated when one agent acts for another

## Where it sits in the stack

`agent-dns/1` is a gateway layer of Web 4 — the agentic internet as a stack of
open protocols. The human map of the whole stack is
[web4](https://github.com/FlashyLabs/web4); its machine twin is
[stack.json](https://github.com/FlashyLabs/stack.json), served at
`/.well-known/stack.json`. This repository serves its own institutional front
door — the same config-driven, dependency-free door every protocol repository in
the estate serves — generated into `site/` by `node scripts/build-site.mjs` from
`site.config.json` and its vendored inputs. It is committed here and, once
deployed, is served at `https://flashylabs.github.io/agent-dns/` (committed as
of 2026-09-29, not yet fetched).

## Status

Status: draft. The contract is `agent-dns/1`. Nothing here is deployed, adopted or measured; the vectors and tests are the whole of the evidence.

**The v1 grammar and reason codes are frozen.** The record grammar (§2.2), the four findings (§4) and the reason codes (§5) of `agent-dns/1` will not change; a change to any of them is `agent-dns/2`, never an edit to v1. This is what lets a consumer vendor the resolver and the vectors and trust them. What remains draft is the surrounding prose, not the wire contract.

Licensed under Apache-2.0 (holder Flashy Labs); the estate register in flashyos `tools/estate-licences.mjs` is the authority.
