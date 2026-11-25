# Security Policy

## Supported versions

Only the latest published version on npm receives security fixes.

| Version | Supported |
| --- | --- |
| latest `1.x` | ✅ |
| older `1.x`, `0.x` | ❌ |

## Reporting a vulnerability

Please **do not** open a public issue for a security vulnerability.

Use GitHub's [private vulnerability reporting](https://github.com/ErwanRaulo/sumlyzer/security/advisories/new)
for this repository instead. Include:

- The version of `sumlyzer` you're using (`npx sumlyzer --version`)
- The command / options that trigger the issue
- Your Node.js version and OS
- Steps to reproduce, or a minimal workspace layout that shows the problem

You should get a response within 3 days. If the report is confirmed, a fix
will be released as soon as reasonably possible and you'll be credited in
the advisory unless you ask otherwise.

## Scope

`sumlyzer` has a single runtime dependency ([`glob`](https://www.npmjs.com/package/glob),
to resolve `workspaces` patterns). It only runs, in a shell like `npm run`
does, the `pre<script>`/`<script>`/`post<script>` commands of workspaces
already declared in the project's own `package.json`. It does
not fetch remote code or accept untrusted input over a network. Every CI
run also audits dependencies (`npm audit`) and scans the source with
[`@nodesecure/js-x-ray`](https://github.com/NodeSecure/js-x-ray). Reports
about either of those (e.g. a flagged dependency or a scan bypass) are
welcome through the same channel above.
