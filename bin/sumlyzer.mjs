#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import { availableParallelism } from "node:os";

import { main } from "../src/run.mjs";
import { NoWorkspacesError, InvalidPackageJsonError, WorkspaceLaunchError, GitDiffError } from "../src/errors.mjs";
import { red } from "../src/reporter.mjs";

function printWorkspaceError(message) {
  console.error(red(message.split("\n").map((line) => `✗ ${line}`).join("\n")));
}

let args;
try {
  ({ values: args } = parseArgs({
    options: {
      ff: { type: "boolean", default: false },
      script: { type: "string", default: "test" },
      junit: { type: "string" },
      concurrency: { type: "string", short: "c", default: "1" },
      changed: { type: "boolean", default: false },
      ref: { type: "string" },
      watch: { type: "boolean", short: "w", default: false },
      help: { type: "boolean", short: "h", default: false }
    }
  }));
}
catch (error) {
  if (error.code?.startsWith("ERR_PARSE_ARGS")) {
    console.info(`${error.message}. Run "sumlyzer --help" for usage.`);
  }
  process.exit(1);
}

let concurrency = Number.parseInt(args.concurrency, 10);
if (!Number.isInteger(concurrency) || concurrency < 1 || String(concurrency) !== args.concurrency) {
  console.info(`--concurrency must be a positive integer, got "${args.concurrency}". Run "sumlyzer --help" for usage.`);
  process.exit(1);
}

const maxConcurrency = availableParallelism();
if (concurrency > maxConcurrency) {
  console.info(`--concurrency ${concurrency} exceeds the available parallelism (${maxConcurrency}), clamping to ${maxConcurrency}.`);
  concurrency = maxConcurrency;
}

if (args.ref && !args.changed) {
  console.info(`--ref only applies with --changed. Run "sumlyzer --help" for usage.`);
  process.exit(1);
}

if (args.watch && args.junit) {
  console.info(`--watch and --junit can't be combined. Run "sumlyzer --help" for usage.`);
  process.exit(1);
}

if (args.help) {
  console.log(`sumlyzer [options]

Runs each npm workspace's "${args.script}" script, ${concurrency > 1 ? `${concurrency} at a time` : "one by one"}. Passing
workspaces collapse to a single line; failing ones print only the relevant
failure detail. Ends with an aggregated pass/fail summary table.

Options:
  --script <name>       npm script to run per workspace (default: "test")
  --ff                  fail fast: stop at the first failing workspace
  --junit <path>        write an aggregated JUnit XML report to <path>
  -c, --concurrency <n> run up to <n> workspaces at once (default: 1)
  --changed             only run workspaces with changes (git ref auto-detected, see --ref)
  --ref <ref>           git ref to diff against for --changed (default: auto-detect)
  -w, --watch           re-run on file change, only for changed workspaces
                         and the ones that depend on them (can't be combined
                         with --junit)
  -h, --help            show this help
`);
  process.exit(0);
}

try {
  await main({
    root: path.resolve(process.cwd()),
    scriptName: args.script,
    ff: args.ff,
    junitPath: args.junit,
    concurrency,
    changed: args.changed,
    ref: args.ref,
    watch: args.watch
  });
}
catch (error) {
  if (error instanceof NoWorkspacesError) {
    console.info(error.message);
  }
  else if (error instanceof InvalidPackageJsonError || error instanceof WorkspaceLaunchError || error instanceof GitDiffError) {
    printWorkspaceError(error.message);
  }
  else {
    throw error;
  }
  process.exitCode = 1;
}
