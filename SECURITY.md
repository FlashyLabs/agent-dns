# Security

## Reporting

Report a security problem privately to **security@flashylabs.com**.

That address is to be confirmed before launch: this repository is a draft and the reporting channel has not yet been verified end to end. If mail to it bounces, open a private security advisory on the repository rather than a public issue, and say in it that the address failed.

Do not open a public issue for a vulnerability. Do not include a working exploit against a third party's domain in any report.

## What counts

For a specification and reference resolver, a security problem is any of:

- a record, redirect or document that the reference resolver **accepts** and the specification says it must refuse — in particular any way to make a resolver fetch a url whose host is not `<domain>` or a subdomain of it, or any non-https url;
- any path by which `unreachable` is reported as `absent`, or either as an empty result;
- a way to make the resolver read more than the size cap, wait past the timeout, or follow more than one redirect;
- a way to make a valid-looking record parse to a different `url` than the one written (parser confusion);
- a credential shape, secret or personal data committed anywhere in the tree.

A disagreement about what the specification *should* say is a spec change, not a security report — see `CONTRIBUTING.md`.

## What this specification does not defend against

`SPEC.md` §6 is the full account. In short: `agent-dns/1` does not authenticate DNS. A spoofed or poisoned TXT answer can produce a wrong `absent` or `invalid` finding, or point a consumer at a different path on the same domain; it cannot, under a conforming resolver, point the consumer off the domain, because the same-domain rule and the https requirement are applied to the record and to every redirect. Consumers needing more should validate DNSSEC where the zone is signed.

## Scope

This repository holds no service, no keys and no data. There is nothing here to rotate.
