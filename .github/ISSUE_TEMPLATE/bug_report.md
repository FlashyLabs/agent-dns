---
name: Bug report
about: The reference resolver, the CLI or a vector does something the specification says it must not
title: "bug: "
labels: bug
---

## What happened

<!-- One or two sentences. What did you run, what did it report? -->

## What the specification says should happen

<!-- Quote or cite the section of SPEC.md. If the spec is silent, this may be a spec change instead. -->

## Vector

<!-- The fastest bug report is a failing vector. Paste one in the vectors/ shape: -->

```json
{
  "contract": "agent-dns/1",
  "description": "",
  "domain": "example.com",
  "records": ["v=agent1; url=https://example.com/.well-known/agent"],
  "expect": { "state": "invalid", "reason": "" }
}
```

## Command and output

```
node vendor-agent-dns.mjs check <your-vector.json>
```

<!-- Paste the exact output. -->

## Environment

- Node version (`node --version`):
- Commit or branch measured (`git rev-parse HEAD`; and say whether this is the default branch):

## Not a security report

<!-- If this lets a resolver fetch off-domain, accept http, over-read, hang, or collapse unreachable into absent, do not file it here — see SECURITY.md. -->
