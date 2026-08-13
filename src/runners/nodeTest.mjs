import { fileURLToPath } from "node:url";

import { stripNpmNoise } from "../parseOutput.mjs";
import { parseReporterEvents, renderFailureRecap, renderSummaryText } from "../testEventReporter.mjs";

const TEST_EVENT_REPORTER_PATH = fileURLToPath(new URL("../testEventReporter.mjs", import.meta.url));

const OWN_TEST_REPORTER_FLAG = /--test-reporter(?!-destination)\b/;

export function hasOwnReporter(scriptCommand) {
  return OWN_TEST_REPORTER_FLAG.test(scriptCommand);
}

export function prepareEnv(env, junitDestPath) {
  const existing = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : "";
  const testReporterFlags = `--test-reporter="${TEST_EVENT_REPORTER_PATH}" --test-reporter-destination=stdout`;
  const junitFlags = junitDestPath ? ` --test-reporter=junit --test-reporter-destination="${junitDestPath}"` : "";
  
  // Drop NODE_TEST_CONTEXT: if sumlyzer itself is invoked from inside a node:test run, this var would otherwise leak.
  const rest = { ...env };
  delete rest.NODE_TEST_CONTEXT;
  return { ...rest, NODE_OPTIONS: `${existing}${testReporterFlags}${junitFlags}` };
}

// Workspaces that don't run through node:test never emit our JSON events; fall
// back to their raw (npm-noise-stripped) output so failures are still visible.
export function parseResult({ exitCode, stdout, stderr }) {
  const { counts, failingTests, failures } = parseReporterEvents(stdout);
  const fallbackOutput = stripNpmNoise(stdout + stderr).trim();
  const failureRecap = failures.length > 0 ? renderFailureRecap(failures) : null;

  return {
    counts,
    failingTests,
    failureDetails: exitCode === 0 ? null : (failureRecap ?? fallbackOutput),
    rawOutput: counts ? [renderSummaryText(counts), failureRecap].filter(Boolean).join("\n\n") : fallbackOutput
  };
}
