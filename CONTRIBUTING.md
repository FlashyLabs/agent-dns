# Contributing

`agent-dns/1` is a draft. Contributions that make it more precise, more refusing, or more honest are welcome; contributions that make it broader are a conversation first.

## Before you open anything

```bash
npm run lint && npm test
```

Both must pass. There is no install step; Node 22 is the only requirement.

## Changing the specification

1. Open a **spec change** issue (`.github/ISSUE_TEMPLATE/spec_change.md`) describing the change, the failure it prevents or the case it admits, and which section of `SPEC.md` it touches.
2. Add or change a vector in `vectors/` first. A vector is `{contract, description, domain, records, expect}`; its file name begins with `valid-`, `absent-` or `invalid-` and must match `expect.state`.
3. Run `npm test` and watch it fail.
4. Change `vendor-agent-dns.mjs` until it passes, then change `SPEC.md` so the prose matches the code. If the change adds a refusal, add its reason code to the Refusals table.
5. Update `schema/agent-dns-1.json` if the parsed record's shape changed.

A pull request that changes the spec without a vector, or a vector without the spec, will be asked for the other half.

## What will not be accepted in version 1

- A Public Suffix List, or any "registrable domain" computation. The same-domain rule is host-or-subdomain by design (`SPEC.md` §7).
- Capability, endpoint or key material in the DNS record. DNS points at the document; the document describes.
- A dependency. `node:` builtins only, in every `.mjs`, including tests and tools.
- Live network access in tests or in CI.
- A code path that reports `unreachable` as `absent`, or either as an empty result.
- Brand names, product names or organisation names inside the record grammar, the schema or the vectors. `example.com`, `example.net` and `org/example` are the only names a vector uses.

## Reporting a bug

Use the **bug report** template. A bug report that includes a failing vector is the fastest kind to fix.

## Security

Do not open an issue for a security problem. See `SECURITY.md`.

## Style

- ESM, `node:` imports, no semicolons dropped, two-space indent.
- Error and reason codes are lowercase, hyphenated, stable once shipped in a vector.
- Prose in `SPEC.md` uses MUST/SHOULD/MAY in the RFC 2119 sense and says nothing the code does not do.
