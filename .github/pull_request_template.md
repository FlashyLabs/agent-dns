## What this changes

<!-- One paragraph. If it changes the specification, link the spec-change issue. -->

## Evidence

<!-- Which vector, test or command shows the change does what it says? A spec change with no vector, or a vector with no spec change, will be asked for the other half. -->

- [ ] `npm run lint` passes
- [ ] `npm test` passes
- [ ] Every claim I changed or added in `README.md` or `SPEC.md` is true of the code in this PR

## Checklist

- [ ] No dependency added — `node:` builtins only, in every `.mjs`
- [ ] No network access in tests or CI
- [ ] No brand, product or organisation name inside the grammar, schema or vectors (`example.com`, `example.net`, `org/example` only)
- [ ] No adoption or deployment claim; the status is still "draft"
- [ ] No LICENSE file added; the README's last line is unchanged
- [ ] No secret, token or credential shape anywhere in the diff
- [ ] If a reason code changed: it is a new code, not a renamed one — codes shipped in a vector are stable
- [ ] If `vendor-agent-dns.mjs` changed: I understand consumers hold byte-identical copies and will re-vendor

## Branch measured

<!-- Which branch and commit did you run the checks on? `main` is not necessarily the default branch: `git symbolic-ref --short refs/remotes/origin/HEAD` -->
