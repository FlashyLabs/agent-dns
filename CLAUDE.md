# agent-dns — `agent-dns/1`

A specification and dependency-free reference resolver for one DNS TXT record at `_agent.<domain>` that points at a domain's `agent/1` discovery document. The naming layer of the agentic internet: DNS points, the document describes. Status: draft.

## Commands

```bash
npm test        # node --test — vectors, parser, validator, resolver, CLI, repository rules
npm run lint    # node tools/lint.mjs — node --check every .mjs, node:-only imports, house rules
npm run check   # node vendor-agent-dns.mjs check vectors — every vector against the reference
```

No install step exists and none is needed. `package.json` has no dependencies of any kind and the lint fails if one appears.

## What makes this repository different

**It is a spec with one file of code, and the code is the spec's evidence.** `SPEC.md` says what a conforming resolver does; `vendor-agent-dns.mjs` does it; `vectors/` are the cases both must agree on; the test suite is what makes "every README/SPEC claim is true of the code" a checked statement rather than a hope. Change the spec, change a vector, watch a test fail, change the code — in that order.

**It touches no network, on purpose.** `resolve()` takes an injected `lookupTxt(name)` and `fetcher(url)`; every test uses in-memory maps. The one snippet that wires `node:dns/promises` and `fetch` is in the README and is labelled as not exercised by tests. Do not add a live-DNS test, a live-fetch test, or a CLI command that resolves a real domain without first deciding how CI, which has no egress guarantee, will run it — the honest answer today is that it will not.

**The file is called `vendor-agent-dns.mjs` because it is meant to be vendored.** Consumers across the estate copy it byte-for-byte and compare against this copy. That is why it imports `node:` builtins only, why the CLI lives in the same file, and why it has exactly one sibling module — `vendor-domain.mjs`, which travels with it. Splitting it further is a decision, not a refactor; the one split that was made is the next paragraph.

**Same-domain means host-or-subdomain, not registrable domain — and the rule is canonical here.** There is no Public Suffix List here and there will not be one in version 1. `vendor-domain.mjs` (`normalizeDomain`, `isSameDomain`, `sameDomainUrl`, no imports at all) is the rule; `test/domain.test.mjs` pins it case by case and `invalid-parent-domain-url` is the vector that pins its narrowness. It is vendored byte-identically into agent-wellknown, bastion and flashy-examples, each with a drift test against this copy — re-vendor, never edit the copies. It was extracted because those three repositories had each written their own "same domain", two of them as a "last two labels" slice that read `acme.co.uk` and `other.co.uk` as one publisher; refusing to guess is the doctrine, and a rule stated four ways is guessed at least once. A contributor who "fixes" `shop.example.com → example.com` to pass has changed the contract in four repositories. The well-known path is `/.well-known/agent` only; there is no `.json` alternate.

## Rules — each enforced by a test

- **Four findings, never collapsed.** `resolve()` returns `ok | absent | unreachable | invalid` and nothing else. A test asserts every finding is one of the four; another enumerates six failure shapes (DNS throws, connection refused, fetch throws, 500, 502, hang past the timeout) and asserts none reads `absent`. Never add a code path that turns a transport failure into an empty result.
- **Refuse, don't guess.** Non-https url, cross-host url, missing `v=agent1`, missing `url`, unknown key without `x-`, repeated key, more than one `v=agent1` record, invalid `<domain>` — each is `invalid` with a stable reason code, and each has a vector whose `expect.reason` names it. Adding a refusal means adding a vector.
- **The stranger is never fetched.** A url that fails the same-domain rule, and a redirect that would leave the domain or drop to http, ends resolution before any request to that host. Tests record every fetcher call and assert the list.
- **Other versions are ignored, not refused.** A record whose first pair is `v=<not agent1>` is skipped; a record with no `v` at all is `invalid`. Both are vectors. This is the forward-compatibility seam; do not widen or narrow it casually.
- **Vector file names say what they expect.** `valid-*` → `ok`, `absent-*` → `absent`, `invalid-*` → `invalid`. A test reads the prefix.
- **The schema admits what the parser produces.** `schema/agent-dns-1.json` is draft 2020-12, `required: ["v","url"]`, `additionalProperties: false`, `x-*` via `patternProperties`. A test checks each valid vector's record against those rules.
- **No dependencies, the Apache-2.0 `LICENSE` present (holder Flashy Labs, per the estate register in flashyos `tools/estate-licences.mjs`), node: imports only, the README's last line is the estate licence line, no credential shapes.** `tools/lint.mjs` holds all of these; `npm run lint` is in CI. The resolver's one relative import is `./vendor-domain.mjs`, and a test asserts that file itself imports nothing — it must run in a pure module and a browser.
- **No adoption claims.** The README test refuses "adopted by", "used by", "trusted by". Nothing here is deployed or measured, and the docs say so.

## House rules — true in every repository in this estate

**`main` is not necessarily the default branch.** Ask, every time: `git symbolic-ref --short refs/remotes/origin/HEAD`.

**Say which branch you measured.** Reading the working tree tells you about your checkout, not the repository.

**Re-vendor before you trust a vendored change.** Files named `vendor-*.mjs` are byte-identical copies; a stale copy disagrees silently.

**No secret in a file, a repo, or an artifact.** Secret Manager only.

**The licence is declared once**, in `tools/estate-licences.mjs` in flashyos. Do not decide this repository's licence inside it.

**A generated file is regenerated, never hand-edited.**

**Report what happened, including when it is worse than expected.**
