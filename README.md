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

<p align="center"><b>A better feedback loop for monorepos organized under npm workspaces</b></p>

`npm run test --workspaces --if-present` runs every workspace but gives no
summary, no fail-fast, and buries an early failure under everyone else's
output. Sumlyzer fixes that, and runs workspaces concurrently too (~3.5x
faster, see [Benchmark](#benchmark)).

Scope: **npm workspaces** running **`node:test`** only, for now. No
pnpm/yarn, no Jest/Vitest/Mocha.

## Install

```
npm install --save-dev sumlyzer
```

## Usage

```
npx sumlyzer [options]
```

Run from the root of an npm workspaces project.

| Flag | Default | Description |
| --- | --- | --- |
| `--script <name>` | `test` | npm script to run per workspace |
| `--ff` | off | stop at the first failing workspace |
| `-c, --concurrency <n>` | `1` | run up to `<n>` workspaces at once |
| `--changed` | off | only run workspaces with changed files |
| `--junit <path>` | off | write an aggregated JUnit XML report |
| `--ref <ref>` | auto-detect | git ref to diff against for `--changed` |
| `-w, --watch` | off | re-run on file change (can't be combined with `--junit`) |
| `-h, --help` | | print usage |

Exit code is `1` if any workspace fails, `0` otherwise — safe to drop straight into CI.

![fail fast example](https://github.com/ErwanRaulo/sumlyzer/blob/main/example.png?raw=true)

## Benchmark

15-workspace monorepo, each workspace's `test` script doing real work (coverage + type-checking):

| Command | Wall-clock time |
| --- | --- |
| `npm run test --workspaces --if-present` | ~22s |
| `sumlyzer` (sequential) | ~21s |
| `sumlyzer --concurrency 8` | **~6s** |

## Reference

- **JUnit** (`--junit <path>`): merges every workspace's `node:test` JUnit output into one file, each `<testsuite>` prefixed with its workspace name. A workspace whose script never produces one is left out, with a warning naming it.
- **GitHub Actions**: on `GITHUB_ACTIONS=true`, each workspace's output is auto-wrapped in a collapsible `::group::` block. No other CI provider has folding support yet.
- **Concurrency** (`--concurrency <n>`): workspaces finish in whatever order they complete, so output interleaves. With `--ff`, only workspaces that haven't started yet are skipped — in-flight ones run to completion.
- **Changed workspaces** (`--changed`): maps changed files to the workspace directory containing them. Ref auto-detection: uncommitted changes → diff against `HEAD`; clean tree with upstream → merge-base with upstream; clean tree with no upstream → `HEAD`.
- **Watch mode** (`--watch`): runs once, then keeps watching the workspaces directories. Re-runs the workspace that changed and Whatever else, in the same project, declares it as a `dependencies`/`devDependencies` entry . `node_modules`, `.git`, `coverage`, and dotfiles are ignored. Stop with `Ctrl+C`. Not compatible with `--junit`.
- Own `--test-reporter` in a workspace's script is detected ahead of time and that workspace is skipped, to avoid colliding with sumlyzer's own reporter.

npm doesn't have native fail-fast on `--workspaces` yet — discussed in
[npm/rfcs#575](https://github.com/npm/rfcs/issues/575) (open) and
[npm/rfcs#602](https://github.com/npm/rfcs/issues/602) (closed), see also this
[Stack Overflow answer](https://stackoverflow.com/questions/71300870/npm-workspace-command-does-not-stop-executing-when-command-fails-for-a-workspace/79989284#79989284).
Sumlyzer's `--ff` gets you there in the meantime.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

MIT
