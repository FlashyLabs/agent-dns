---
name: Spec change
about: Propose a change to agent-dns/1 — the grammar, the resolution algorithm, a finding, a refusal
title: "spec: "
labels: spec
---

## The change

<!-- What should SPEC.md say that it does not, or stop saying? Name the section. -->

## The case it prevents or admits

<!-- A concrete record, domain and expected finding. Every spec change ships with a vector, so write it here first. -->

```json
{
  "contract": "agent-dns/1",
  "description": "",
  "domain": "example.com",
  "records": [],
  "expect": { "state": "" }
}
```

## Why refusing is not enough

<!-- The default answer in this specification is to refuse rather than guess. If the change makes the resolver accept something it currently refuses, say why the ambiguity is not real. -->

## What it touches

- [ ] `SPEC.md` grammar (§2)
- [ ] `SPEC.md` resolution algorithm (§3)
- [ ] the four findings (§4) — a change here needs a very good reason
- [ ] a refusal and its reason code (§5)
- [ ] `schema/agent-dns-1.json`
- [ ] `vendor-agent-dns.mjs`
- [ ] `vectors/`

## Compatibility

<!-- Does a record valid today become invalid, or the reverse? Does a version-1 resolver that has not taken this change still report the four findings correctly for records written under it? -->

## Out of scope for version 1 (check if you are asking to reopen one)

- [ ] Public Suffix List / registrable domain
- [ ] capabilities or keys in DNS
- [ ] DNSSEC mandate
- [ ] multiple records, priorities, fallbacks
