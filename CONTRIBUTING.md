# Contributing

Thanks for taking the time to contribute!

## Scope

`sumlyzer` is intentionally narrow: **npm workspaces** running **`node:test`**.
Before proposing support for another package manager (pnpm, yarn) or another
test runner (Jest, Vitest, Mocha...), please open an issue to discuss it,
that's a significant expansion of scope, not a small patch.

## Setup

Requires Node.js >= 22 (native `styleText`, `Promise.withResolvers`).

```
git clone <your fork>
cd sumlyzer
npm ci
```

`npm run security-scan` (js-x-ray) needs Node.js >= 24.

## Running the tests

```
npm test
npm run typecheck
```

Try the CLI against a real npm workspaces project while you're at it:

```
node bin/sumlyzer.mjs --help
node /path/to/sumlyzer/bin/sumlyzer.mjs --ff
```

## Architecture

| Module | Role |
| --- | --- |
| `run.mjs` | `main({ reporter, ... })`: wires the steps below, returns `{ failed }` |
| `workspaces.mjs` | Resolves and loads workspaces and their script phases |
| `schedule.mjs` | Worker pool, `--concurrency`, `--ff` |
| `workspaceProcess.mjs` | Spawns phases, kills process trees, handles interrupts |
| `scriptEnv.mjs` | Child environment: npm variables, `PATH`, runner options |
| `runner.mjs` | The test runner in use (`runners/nodeTest.mjs`) |
| `changed.mjs`, `watch.mjs`, `junitReport.mjs` | `--changed`, `--watch`, `--junit` |
| `reporter.mjs` | Terminal output, the only module that writes; passed to `main()` by the CLI |

## Conventions

- Keep runtime dependencies to a minimum (currently only `glob`). Prefer a
  native Node.js API over adding a package.
- Keep `src/` functions small and pure where possible, so they can be unit
  tested directly (`test/<module>.spec.mjs`) without depending on hidden
  state. End-to-end behavior goes through the CLI (`test/cli.spec.mjs`).
- Only export what `bin/sumlyzer.mjs` or the test suite actually import.
  Everything else stays internal (see `package.json`, which has no `main` /
  `exports`, the CLI is the only public surface).
- No comments explaining *what* code does, name things clearly instead.
  A comment is only worth it for a non-obvious *why*.

## Submitting changes

1. Fork the repo and create a branch from `main`.
2. Make your change, with a test if it changes behavior.
3. Make sure `npm test` passes.
4. Add a line under `## [Unreleased]` in [CHANGELOG.md](./CHANGELOG.md) if
   the change is user-facing.
5. Open a pull request describing the problem it solves.

## Reporting bugs

Please include: the command you ran, your Node version, and, if the bug is
about parsing test output, the relevant snippet of `node:test`'s output
that didn't parse as expected.
