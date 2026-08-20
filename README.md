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
 
`npm run test --workspaces --if-present` runs every workspace, but gives you no
aggregated summary and no way to fail fast, no way to catch an early failure that scrolled off screen.

Sumlyzer gives you all those possibilities and even more like concurrency or JUnit reports.

## Requirements

- Node.js >= 22.0.0
- An npm workspaces project (`package.json` with a `workspaces` field)

## Scope

This tool is intentionally narrow: **npm workspaces** running **`node:test`**.

It orchestrates `npm run <script> --workspace=<path>` for every workspace that
declares the target script, and it parses node test's own output to build
the global and per workspace summary. 

It does not support pnpm/yarn workspaces or other test runners
(Jest, Vitest, Mocha etc.). (for the moment)

sumlyzer forces its own `node:test` reporter onto every workspace via
`NODE_OPTIONS`, so a workspace's `test` script should just run `node --test`
without configuring its own `--test-reporter`.
sumlyzer detects this ahead of time and skips that workspace instead of running into it.

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
| `-h, --help` | | print usage |

Exit code is `1` if any workspace fails (even if every workspace's tests passed), `0` otherwise, wire it straight into CI without extra parsing.
This also applies when `--junit` can't write its report.

## Features

- Aggregated pass/fail summary table.
- Fail-fast (`--ff`): stop at the first failing workspace
- Aggregated JUnit XML report (`--junit`), merging every workspace's own results
- GitHub Actions log folding: each workspace's output collapsed into an
  expandable group, automatically, no flag needed
- Concurrent runs (`--concurrency <n>`): run several workspaces' test scripts
  at once instead of one by one

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
| `duration`      | Wall-clock time for the whole `npm run <script> --workspace=<path>` process, including npm/spawn overhead |
| `tests`         | Total number of tests node:test ran in that workspace                                            |
| `pass`          | Number of passing tests                                                                          |
| `fail`          | Number of failing tests                                                                          |

Skipped (`t.skip()`), todo (`t.todo()`), and cancelled tests are rare enough
that a column of zeros for every workspace would just bury the one row that
has a nonzero count. Instead, sumlyzer prints a footnote below the table,
naming only the workspaces that actually have some, e.g. `skipped tests:
flags (2)`.


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
section instead of the terminal's formal.

This is automatic, no flag needed, and keeps the job log short by default
while still letting you expand any workspace, passing or failing, to see its
full suite output. 

No other CI provider is currently supported: GitHub is the
only one whose log folding sumlyzer has actually verified end-to-end.

### Concurrency

`--concurrency <n>` runs up to `<n>` workspaces' scripts at the same time
instead of one after another, which can noticeably cut wall-clock time on
projects with many workspaces.

Since workspaces can now finish in any order, their output interleaves in
whatever order they complete, rather than following the `workspaces` list
order.

With `--ff`, a failure only stops workspaces that haven't started yet; any
workspace already running when the failure is detected runs to completion
(sumlyzer doesn't kill in-flight processes).

![Concurrent run stopping early on failure](https://github.com/ErwanRaulo/sumlyzer/blob/main/concurrency-failed.png?raw=true)

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
