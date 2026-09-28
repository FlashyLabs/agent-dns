# agent-dns/1

Status: draft. Contract name: `agent-dns/1`.

This document specifies how a domain publishes, and how a resolver finds, the location of the domain's `agent/1` discovery document using one DNS TXT record. It specifies the record grammar, the resolution algorithm, the four findings a resolver reports, what a resolver refuses, and what version 1 deliberately does not carry.

The words MUST, MUST NOT, SHOULD and MAY are used in their RFC 2119 sense.

## 1. Scope

`agent-dns/1` answers one question: *given a domain, where is its agent discovery document?* It does not describe the organisation, its agents or their capabilities. Those live in the `agent/1` document (a sibling specification, not redefined here) that the record points at. DNS points; the document describes.

The relationship is domain → organisation → agent → capability. This specification covers the first arrow only, and the `org` key is the one piece of the second arrow it carries: a hint, not an authority, about which organisation the document belongs to.

## 2. The record

### 2.1 Location

The record is a DNS TXT record at the name `_agent.<domain>`, where `<domain>` is the domain being resolved. For `example.com` the name is `_agent.example.com`.

`<domain>` MUST be a valid hostname: ASCII (internationalised names are IDNA-encoded first), at least two labels, each label 1–63 characters of `[a-z0-9-]` not beginning or ending with a hyphen, 253 characters or fewer in all, and not an IPv4 literal. Case is not significant and a trailing dot is ignored. A `<domain>` containing an underscore is not a hostname, so `_agent.example.com` cannot itself be resolved.

A TXT record's character-strings are concatenated without separators to form the record string. Publishers SHOULD keep a record under 255 octets so it fits one character-string.

### 2.2 Grammar

```
record  = pair *( ";" *SP pair ) [ ";" ]
pair    = key "=" value
key     = LALPHA *( LALPHA / DIGIT / "-" )      ; lowercase
value   = 1*( %x21-3A / %x3C-7E )               ; visible ASCII except ";"
LALPHA  = %x61-7A
```

Leading and trailing whitespace around the whole record is ignored. Whitespace is permitted only after a `;`. A value MUST NOT contain `;` or whitespace, so a URL carrying either MUST be percent-encoded by the publisher; a resolver does not repair it.

### 2.3 Keys

| Key | Required | Value |
|---|---|---|
| `v` | yes | Exactly `agent1`. MUST be the first pair. |
| `url` | yes | The https URL of the domain's `agent/1` document. See §2.4. |
| `org` | no | `org/<slug>`, slug `[a-z0-9][a-z0-9-]*`. The organisation the document belongs to. |
| `x-*` | no | Private extensions, `x-` followed by `[a-z0-9][a-z0-9-]*`. A resolver carries them through and never acts on them. |

Any other key is refused. A key MUST NOT appear more than once in a record.

`v` first is what lets a resolver tell an `agent-dns` record of another version from a malformed record without parsing it (§3, step 3). It is the same convention SPF (`v=spf1`) and DMARC (`v=DMARC1`) use.

### 2.4 The url

The `url` MUST:

- parse as a URL;
- use the `https` scheme;
- carry no userinfo (no `user:pass@`);
- have a host that is `<domain>` itself or a subdomain of `<domain>`.

The last rule is the **same-domain rule**. A record may not point a domain at a document on another domain — `_agent.example.com` may not name `https://example.net/…`, and it may not name `https://example.com/…` if the record is for `shop.example.com` either. Version 1 defines "same domain" as *host equals `<domain>` or ends with `.<domain>`*; it does not compute a registrable domain, because doing so needs a Public Suffix List and a resolver without one would have to guess whether `co.uk` is a suffix (§7). The rule is strictly narrower than "same registrable domain": everything it admits, a PSL-based rule would admit too.

A port is permitted. A path, query and fragment are permitted; the conventional path is `/.well-known/agent`, and `agent/1` says what is served there.

### 2.5 Examples

Valid:

```
v=agent1; url=https://example.com/.well-known/agent
v=agent1; url=https://example.com/.well-known/agent; org=org/example
v=agent1; url=https://agents.example.com/.well-known/agent
v=agent1;url=https://example.com/.well-known/agent;x-note=hello;
```

Invalid, with the reason a resolver reports:

```
v=agent1; url=http://example.com/.well-known/agent            url-not-https
v=agent1; url=https://example.net/.well-known/agent           url-cross-host   (for example.com)
v=agent1; org=org/example                                     missing-url
url=https://example.com/.well-known/agent                     missing-version
url=https://example.com/.well-known/agent; v=agent1           version-not-first
v=agent1; url=https://example.com/.well-known/agent; cap=x    unknown-key
```

The parsed form of a valid record is the object `schema/agent-dns-1.json` describes: `{ "v": "agent1", "url": "…", "org"?: "…", "x-…"?: "…" }`. The schema checks shape; the same-domain rule needs the domain and is checked by the resolver.

## 3. Resolution

A resolver takes `<domain>` and two transports — a TXT lookup and an https fetcher — and returns exactly one finding (§4). The reference implementation is `resolve()` in `vendor-agent-dns.mjs`; `selectRecord()` is steps 2–4, pure and synchronous.

**Step 1 — validate the domain.** If `<domain>` is not a valid hostname (§2.1), the finding is `invalid` / `invalid-domain`. Nothing is looked up.

**Step 2 — query.** Query TXT for `_agent.<domain>`. The transport MUST return the list of record strings, each with its character-strings joined, and MUST return an empty list when the name has no TXT records (NXDOMAIN or NODATA). If the transport fails to obtain an answer — timeout, SERVFAIL, refused, no route — the finding is `unreachable` / `dns-failure` (or `dns-timeout` when the resolver's own cap fired). The resolver applies a timeout to the lookup; the default is 5000 ms.

**Step 3 — classify.** Each record string is classified by its first pair:

- first pair is `v=agent1` — a **candidate**;
- first pair is `v=<anything else>` — **another version**, ignored by a version-1 resolver;
- anything else — **malformed**: the finding is `invalid`, with the parser's first error as the reason (typically `missing-version` or `version-not-first`).

A malformed record at `_agent.<domain>` is a defect in the domain's publication, not another version, so it is refused rather than skipped.

**Step 4 — select.** If there is more than one candidate, the finding is `invalid` / `duplicate-records`: two records is an ambiguity, and a resolver MUST NOT resolve it by choosing one. If there is no candidate, the finding is `absent` / `no-record` (or `no-v1-record` when only other versions were present). Otherwise the single candidate is parsed against §2.2–2.3 and validated against §2.4. Any error makes the finding `invalid` with that error's code as the reason, and the document is not fetched. A resolver MUST NOT fetch a url that failed the same-domain rule.

**Step 5 — fetch.** Fetch the url with these consumer rules:

- a timeout per hop (default 5000 ms), and a size cap on the body (default 65536 bytes);
- at most one redirect (3xx with `Location`), and only to an https URL whose host passes the same-domain rule against `<domain>`. A second redirect is `invalid` / `too-many-redirects`; a redirect elsewhere is `invalid` / `redirect-cross-host`; a redirect to http is `invalid` / `redirect-not-https`. The transport MUST NOT follow redirects itself;
- 404 or 410 is `absent` / `document-absent` — the record exists but the document does not, and the finding carries the url that was tried;
- 5xx is `unreachable` / `document-server-error`;
- any other non-2xx status is `invalid` / `document-status-<n>`;
- a body over the cap (by `Content-Length` or by measurement) is `invalid` / `document-too-large`;
- a body that is not JSON is `invalid` / `document-not-json`; JSON that is not an object is `invalid` / `document-not-object`.

A transport failure — connection refused, reset, TLS error, the resolver's timeout — is `unreachable` / `fetch-failure` or `fetch-timeout`.

**Step 6 — report.** A 2xx object body is `ok`, with the final url, the parsed record and the parsed document. This specification does not validate the document's contents; that is `agent/1`'s job and the consumer's next step.

## 4. The four findings

| State | Meaning | What it is evidence of |
|---|---|---|
| `ok` | A record was found, it was valid for this domain, and the document was fetched and parsed. | The domain publishes an agent document at `url`. |
| `absent` | The DNS answered that there is no record, or the document host answered 404/410. | The domain does not publish one (at this moment, from this vantage). |
| `unreachable` | The resolver could not get an answer: DNS failure or timeout, fetch failure or timeout, or a 5xx. | **Nothing about the domain.** A fact about this resolver's connectivity or the host's health right now. |
| `invalid` | Something was there and it was wrong: malformed record, non-https or cross-host url, unknown key, duplicate records, a bad domain, a redirect or document that broke the rules. | The domain publishes something, and it does not conform. |

Every finding carries `state`; all but `ok` carry a `reason` code from §3; `invalid` carries the parser's or validator's `errors`; findings after step 4 carry the `url` involved.

**They are never collapsed.** A resolver MUST NOT report `unreachable` as `absent`, and MUST NOT report either as an empty result. The reason is what a consumer does next: on `absent` it may reasonably stop asking; on `unreachable` it should retry or ask from somewhere else; on `invalid` the domain's publisher has something to fix and the reason says what. Collapsing `unreachable` into `absent` turns a fact about one resolver's network into a claim about another organisation — the same mistake as a directory that reports zero entries when it could not read the index. Null is never zero. The reference implementation's test suite enumerates six failure shapes and asserts none of them reads `absent`.

A resolver MAY add fields to a finding (the DNS `name` queried, the HTTP `status`, the byte count) and MUST NOT remove or rename `state` or `reason`.

## 5. Refusals

A conforming parser or resolver refuses — reports `invalid`, never repairs, never guesses — each of the following. Each has a stable reason code and a vector in `vectors/`.

| Refused | Reason code |
|---|---|
| `<domain>` is not a valid hostname | `invalid-domain` |
| Record does not begin with `v=agent1` and has no `v` | `missing-version` |
| `v` is present but not the first pair | `version-not-first` |
| `v` is a value other than `agent1` in a record selected for parsing | `unsupported-version` |
| No `url` | `missing-url` |
| `url` does not parse | `url-unparseable` |
| `url` is not https | `url-not-https` |
| `url` carries userinfo | `url-has-credentials` |
| `url` host is not `<domain>` or a subdomain of it | `url-cross-host` |
| `org` is not `org/<slug>` | `invalid-org` |
| A key the contract does not name, not prefixed `x-` | `unknown-key` |
| A key that repeats | `duplicate-key` |
| A pair with no `=`, an empty pair, an empty or non-ASCII value | `malformed-pair`, `empty-pair`, `invalid-value` |
| More than one `v=agent1` record at the name | `duplicate-records` |
| A redirect off the domain, to http, without `Location`, or a second redirect | `redirect-cross-host`, `redirect-not-https`, `redirect-missing-location`, `too-many-redirects` |
| A document over the size cap, not JSON, or not a JSON object | `document-too-large`, `document-not-json`, `document-not-object` |

Two things are deliberately **not** refused: records of other versions at the same name (ignored, §3 step 3), and `x-` keys (carried through, §2.3). Both are what let the format move without breaking a version-1 resolver.

## 6. Security considerations

**Cross-host pointers are refused, and that is the central control.** DNS for `example.com` is controlled by whoever controls `example.com`. If a record could name a document anywhere, the holder of one domain could present a stranger's agents as their own, or point a well-known domain's consumers at a document they control. The same-domain rule ties the document to the DNS that named it: whoever published the record could also have published the document. The rule is applied to the initial url and to every redirect, and a resolver never fetches a url that fails it.

**DNS is not authenticated by this specification.** A plain TXT lookup can be spoofed, cached poisoned or answered by a resolver on the path. `agent-dns/1` does not mandate DNSSEC (§7). A consumer that needs the record to be authentic SHOULD validate DNSSEC where the zone is signed, or use a resolver that does, and SHOULD treat the record as a pointer whose target is then authenticated by TLS: the https requirement means the document is fetched from a host that presented a certificate for the same domain the record claimed. Spoofing the record alone therefore cannot redirect a consumer off the domain; it can at most point at a different path on the same domain, or cause an `absent` or `invalid` finding — which is a reason `unreachable` and `invalid` are reported and never hidden.

**https only.** An http url is refused at parse time, and an http redirect is refused at fetch time. There is no downgrade path.

**Caps are consumer rules, not suggestions.** The size cap bounds what a resolver will read from a host it has not yet trusted; the timeout bounds how long a hostile or broken host can hold a resolver; the single-redirect limit bounds a redirect loop to two requests. A resolver MAY lower the defaults and SHOULD NOT raise the redirect limit.

**The record is public.** Anything in it is readable by anyone who can query DNS. Publishers MUST NOT place secrets, tokens or personal data in a record, including in `x-` keys.

**`org` is a hint.** A record saying `org=org/acme` proves only that the domain's DNS holder typed it. Whether the domain belongs to that organisation is established elsewhere — by the organisation's own charter naming the domain, or by the document — never by this record alone.

## 7. What version 1 does not carry

- **No DNSSEC mandate.** Requiring it would exclude most zones today. The https requirement and same-domain rule bound what a spoofed record can achieve; §6 says what a consumer needing more should do.
- **No capabilities in DNS.** The record names one url and nothing about what the agents can do. Capability records in DNS would be a second description that drifts from the document, and TXT is the wrong place for a list. DNS only points at the document.
- **No Public Suffix List.** Version 1's same-domain rule is host-equals-or-subdomain, which needs no list and cannot be wrong about a suffix. The cost is that a record for `shop.example.com` may not point at `example.com`; the publisher puts the record at `_agent.example.com` instead, or serves the document under `shop.example.com`.
- **No multiple records, no priorities, no fallbacks.** One record, one url. Load distribution and failover belong behind the url.
- **No record signing, no keys, no expiry.** The record is a pointer; freshness comes from DNS TTL and authenticity from TLS at the target.
- **No transport in the reference implementation.** `resolve()` takes an injected `lookupTxt` and `fetcher` so it can be tested without a network; wiring `node:dns/promises` and `fetch` is shown in the README and is the consumer's.

## 8. Conformance

An implementation conforms to `agent-dns/1` if, for every vector in `vectors/`, `selectRecord(domain, records)` (or its equivalent) produces the `state`, and where given the `reason`, `url` and `record`, that the vector's `expect` names; and if its resolver reports the four findings of §4 under the conditions of §3 without collapsing any two. `node vendor-agent-dns.mjs check vectors` runs the first half against the reference implementation; the test suite runs the second.
