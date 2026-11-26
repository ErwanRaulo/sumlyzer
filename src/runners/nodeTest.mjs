import { stripNpmNoise } from "../parseOutput.mjs";
import { parseReporterEvents, renderFailureRecap, renderSummaryText } from "../testEventReporter.mjs";

// A file:// URL rather than a path: on Windows the ESM loader rejects an absolute
// path such as "D:\\..." as an unsupported URL scheme.
const TEST_EVENT_REPORTER_URL = new URL("../testEventReporter.mjs", import.meta.url).href;

const OWN_TEST_REPORTER_FLAG = /--test-reporter(?!-destination)\b/;

export function hasOwnReporter(scriptCommand) {
  return OWN_TEST_REPORTER_FLAG.test(scriptCommand);
}

// Inside a quoted NODE_OPTIONS value, node treats "\\" as an escape character, so a
// Windows path would silently lose its separators unless they're doubled.
function quoteNodeOption(value) {
  return `"${value.replace(/[\\"]/g, "\\$&")}"`;
}

export function prepareEnv(env, junitDestPath) {
  const existing = env.NODE_OPTIONS ? `${env.NODE_OPTIONS} ` : "";
  const testReporterFlags = `--test-reporter=${quoteNodeOption(TEST_EVENT_REPORTER_URL)} --test-reporter-destination=stdout`;
  const junitFlags = junitDestPath ? ` --test-reporter=junit --test-reporter-destination=${quoteNodeOption(junitDestPath)}` : "";
  
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
