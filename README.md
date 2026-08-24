<p align="center">
  <img src="https://github.com/ErwanRaulo/sumlyzer/blob/main/logo.png?raw=true" alt="Sumlyzer logo" width="140" />
</p>

<h1 align="center">Sumlyzer</h1>

<p align="center">
  <a href="https://www.npmjs.com/package/sumlyzer"><img src="https://img.shields.io/npm/v/sumlyzer.svg" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/sumlyzer"><img src="https://img.shields.io/npm/dm/sumlyzer.svg" alt="npm downloads" /></a>
  <a href="https://www.npmjs.com/package/sumlyzer"><img src="https://img.shields.io/node/v/sumlyzer.svg" alt="node engine" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/npm/l/sumlyzer.svg" alt="license" /></a>
</p>

## Ever wished a faster feedback when testing your npm workspaces?

`npm run test --workspaces --if-present` runs every workspace, but gives no
aggregated summary, no fail-fast, and lets an early failure scroll off screen
unnoticed.

Sumlyzer gives you all those possibilities and even more like concurrency
(~3.5x faster on a real 15-workspace monorepo, see [Benchmark](#benchmark)) or JUnit reports.

## Requirements

- Node.js >= 22.0.0
- An npm workspaces project (`package.json` with a `workspaces` field)

## Scope

Intentionally narrow: **npm workspaces** running **`node:test`**. It does not
support pnpm/yarn workspaces or other test runners (Jest, Vitest, Mocha etc.) for the moment.

It runs each workspace's script directly (no `npm run` in between) but still
chains its `pre`/`post` lifecycle scripts (e.g. `pretest`) itself, with the
same semantics as `npm run`: a failing `pre<script>` skips the rest, and a
failing `post<script>` still fails the workspace even if the main script passed.

sumlyzer forces its own `node:test` reporter via `NODE_OPTIONS`, so a
workspace that sets its own `--test-reporter` is detected ahead of time
and skipped instead of colliding with it.

## Install

```
npm install --save-dev sumlyzer
```

## Usage

```
npx sumlyzer [options]
```

Run from the root of an npm workspaces project (where `package.json` has a
`workspaces` field).

Options:

| Flag | Default | Description |
| --- | --- | --- |
| `--script <name>` | `test` | npm script to run per workspace |
| `--ff` | off | fail fast: stop at the first failing workspace |
| `--junit <path>` | off | write an aggregated JUnit XML report to `<path>` |
| `-c, --concurrency <n>` | `1` | run up to `<n>` workspaces at once |
| `--changed` | off | only run workspaces with changed files (git ref auto-detected, see `--ref`) |
| `--ref <ref>` | auto-detect | git ref to diff against for `--changed` |
| `-h, --help` | | print usage |

Exit code is `1` if any workspace fails, `0` otherwise. Safe to wire straight
into CI without extra parsing. This also applies when `--junit` can't write
its report.

## Benchmark

Measured on a real 15-workspace monorepo where each workspace's `test` script does real work (coverage + type-checking), averaged over a few runs on the same machine:

| Command                                  | Wall-clock time |
| ----------------------------------------- | ---------------- |
| `npm run test --workspaces --if-present`  | ~22s             |
| `sumlyzer` (default, sequential)          | ~21s             |
| `sumlyzer --concurrency 8`                | **~6s**          |

See [Concurrency](#concurrency) for where that gain comes from.

## Roadmap

- **Watch mode**: walking the workspace dependency graph (topological sort) so a change in
  one workspace also re-runs the workspaces that depend on it.

## Example

![fail fast example](https://github.com/ErwanRaulo/sumlyzer/blob/main/example.png?raw=true)

### Summary columns

| Column          | Meaning                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------ |
| `(index)`       | Workspace name |
| `status`        | `PASS`, `FAIL`, or `SKIPPED` (reached when `--ff` stopped scheduling before this workspace ran) |
| `duration`      | Wall-clock time for the workspace's script process, including spawn overhead |
| `tests`         | Total number of tests node:test ran in that workspace                                            |
| `pass`          | Number of passing tests                                                                          |
| `fail`          | Number of failing tests                                                                          |

Skipped (`t.skip()`), todo (`t.todo()`), and cancelled tests are rare enough
that a column of zeros for every workspace would just bury the one row that
has a nonzero count. Instead, sumlyzer prints a footnote below the table,
naming only the workspaces that actually have some, e.g. `skipped tests:
flags (2)`.

## Reference

### JUnit report

`--junit <path>` writes a single aggregated JUnit XML report to `<path>`, merging
every workspace's own `node:test` results. Each workspace runs with `node:test`'s
built-in `junit` reporter enabled alongside the terminal one, and sumlyzer combines
the resulting files into one document, prefixing every `<testsuite>` name with the
workspace it came from so CI test-report UIs (GitLab, Jenkins, Azure DevOps, ...)
can tell them apart.

```
npx sumlyzer --junit reports/junit.xml
npx sumlyzer --junit reports/           # writes reports/junit.xml
```

```xml
<testsuites>
  <testsuite name="contact › contact tests">...</testsuite>
  <testsuite name="scanner">...</testsuite>
</testsuites>
```

A workspace whose script never produces a junit file is left out of the aggregated report and sumlyzer
prints a warning naming it.

### GitHub Actions log folding

On GitHub Actions (detected via `GITHUB_ACTIONS=true`), each workspace's full
`node:test` output is wrapped in a collapsible `::group::`/`::endgroup::`
section instead of the terminal's format.

This is automatic, no flag needed, keeping the job log short while still
letting you expand any workspace's full output.

No other CI provider is currently supported: GitHub is the
only one whose log folding sumlyzer has actually verified end-to-end.

### Concurrency

`--concurrency <n>` runs up to `<n>` workspaces' scripts at the same time
instead of one after another (something npm doesn't support natively) 
which can noticeably cut wall-clock time on projects with
many workspaces (see [Benchmark](#benchmark)).

Since workspaces can now finish in any order, their output interleaves in
whatever order they complete, rather than following the `workspaces` list
order.

With `--ff`, a failure only stops workspaces that haven't started yet; any
workspace already running when the failure is detected runs to completion
(sumlyzer doesn't kill in-flight processes).

![Concurrent run stopping early on failure](https://github.com/ErwanRaulo/sumlyzer/blob/main/concurrency-failed.png?raw=true)

### Changed workspaces

`--changed` only runs workspaces whose own files changed according to git,
skipping the rest. It maps each changed file to the workspace directory that
contains it.

```
npx sumlyzer --changed
npx sumlyzer --changed --ref origin/main
```

Without `--ref`, the git ref to diff against is auto-detected:

- Uncommitted changes present → diff against `HEAD` (the local dev loop).
- Clean working tree with an upstream branch configured → diff against the
  merge-base with that upstream, so commits already on the branch count as
  "changed" without pulling in unrelated commits the upstream picked up in
  the meantime.
- Clean working tree with no upstream configured (or no common ancestor, e.g.
  a shallow clone) → `HEAD`, which reports "no changes".

## Why

This fail-fast behavior at the `--workspaces` level has been requested from
npm more than once: [npm/rfcs#575](https://github.com/npm/rfcs/issues/575)
(open) and [npm/rfcs#602](https://github.com/npm/rfcs/issues/602) (closed).
Until it lands, sumlyzer's `--ff` flag gets you there, see also this
[Stack Overflow answer](https://stackoverflow.com/questions/71300870/npm-workspace-command-does-not-stop-executing-when-command-fails-for-a-workspace/79989284#79989284)
on the same problem.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, conventions, and how to submit changes.

## License

MIT
