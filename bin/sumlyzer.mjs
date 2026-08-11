#!/usr/bin/env node
import { parseArgs } from "node:util";
import path from "node:path";
import { availableParallelism } from "node:os";

import { main } from "../src/run.mjs";
import { NoWorkspacesError, InvalidPackageJsonError, WorkspaceLaunchError } from "../src/errors.mjs";
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
    concurrency
  });
}
catch (error) {
  if (error instanceof NoWorkspacesError) {
    console.info(error.message);
  }
  else if (error instanceof InvalidPackageJsonError || error instanceof WorkspaceLaunchError) {
    printWorkspaceError(error.message);
  }
  else {
    throw error;
  }
  process.exitCode = 1;
}
