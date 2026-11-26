import { styleText } from "node:util";

import { workspaceName } from "./workspaces.mjs";

const green = (str) => styleText("green", str);
export const red = (str) => styleText("red", str);
const blue = (str) => styleText("blue", str);
const dim = (str) => styleText("dim", str);
const bold = (str) => styleText("bold", str);

export function formatSeconds(ms) {
  const seconds = Number.isFinite(ms) ? ms / 1000 : 0;
  return `${seconds.toFixed(1)}s`;
}

// GitHub Actions: https://docs.github.com/actions/how-tos/write-workflows/choose-what-workflows-do/workflow-commands#grouping-log-lines
export function githubGroupSyntax(env) {
  if (env.GITHUB_ACTIONS === "true") {
    return {
      start: (title) => `::group::${title}`,
      end: () => "::endgroup::"
    };
  }
  return null;
}

export function ciGroupTitle(name, result) {
  const seconds = formatSeconds(result.durationMs);
  const countsLabel = result.counts ? ` (${result.counts.pass}/${result.counts.tests} tests)` : "";
  const icon = result.exitCode === 0 ? "✓" : "✗";
  return `${icon} ${name} ${seconds}${countsLabel}`;
}

function printWorkspaceResultCi(name, result, ciGroup) {
  process.stdout.write(`${ciGroup.start(ciGroupTitle(name, result))}\n`);
  process.stdout.write(`${result.rawOutput || "(no output captured)"}\n`);
  process.stdout.write(`${ciGroup.end()}\n`);
}

export function printWorkspaceResult(name, result, ciGroup = githubGroupSyntax(process.env)) {
  if (ciGroup) {
    printWorkspaceResultCi(name, result, ciGroup);
    return;
  }

  if (result.exitCode === 0) {
    process.stdout.write(green(`✓ ${name}\n`));
    return;
  }

  process.stdout.write(`\n${bold(red(`✗ ${name} failed`))} ${dim(`(exit code ${result.exitCode})`)}\n`);
  process.stdout.write(result.failureDetails + "\n\n");
}

function summaryRow(status, duration, counts) {
  return {
    status,
    duration,
    tests: counts?.tests ?? "-",
    pass: counts?.pass ?? "-",
    fail: counts?.fail ?? "-"
  };
}

// skip/todo/cancelled are rare in practice: a full column of zeros for every
// workspace buries the one row that actually has a nonzero count, so they're
// called out as a footnote instead of living in the table.
function extraCountsFootnote(results, key, label) {
  const entries = results
    .filter(({ counts }) => Number(counts?.[key]) > 0)
    .map(({ workspace, counts }) => `${workspace.name} (${counts[key]})`);

  return entries.length > 0 ? `${label}: ${entries.join(", ")}` : null;
}

export function printSummary(results, skipped) {
  console.log(bold("\nSummary"));

  const rows = {};
  for (const { workspace, exitCode, durationMs, counts } of results) {
    rows[workspace.name] = summaryRow(exitCode === 0 ? "PASS" : "FAIL", formatSeconds(durationMs), counts);
  }
  for (const workspace of skipped) {
    rows[workspace.name] = summaryRow("SKIPPED", "-", null);
  }

  console.table(rows);

  for (const [key, label] of [["skip", "skipped tests"], ["todo", "todo tests"], ["cancelled", "cancelled tests"]]) {
    const footnote = extraCountsFootnote(results, key, label);
    if (footnote) {
      console.log(blue(`ℹ ${footnote}`));
    }
  }

  if (skipped.length > 0) {
    console.log(dim(`${skipped.length} workspace(s) skipped (--ff): ${skipped.map((workspace) => workspace.name).join(", ")}`));
  }
}

export function reportOutcome(results) {
  const failed = results.filter((result) => result.exitCode !== 0);

  if (failed.length === 0) {
    console.log(green(`${results.length}/${results.length} workspaces passed.`));
    return;
  }

  console.log(red(`${failed.length}/${results.length} workspace(s) failed:`));
  for (const result of failed) {
    console.log(red(`  ${result.workspace.name}`));
    for (const testName of result.failingTests) {
      console.log(dim(`    ✖ ${testName}`));
    }
  }
}

export function printWorkspaceStart(name) {
  process.stdout.write(dim(`running ${name}\n`));
}

export function printChangedRef({ label, reason, autoDetected }) {
  if (autoDetected) {
    console.log(dim(`--changed: no --ref given, comparing against "${label}" (${reason})`));
  }
}

export function printChangedSelection({ label, total, selection }) {
  if (!selection.hasChanges) {
    console.log(dim(`No changes detected against "${label}".`));
    return;
  }

  const { rootChangeFiles, affected, dependents } = selection;
  if (rootChangeFiles.length > 0) {
    const suffix = rootChangeFiles.length > 1 ? ` (+${rootChangeFiles.length - 1} more)` : "";
    console.log(dim(`--changed: "${rootChangeFiles[0]}"${suffix} is outside every workspace, ignoring`));
  }

  const dependentsNote = dependents.length > 0 ? ` (incl. dependents: ${dependents.join(", ")})` : "";
  console.log(dim(`--changed: running ${affected.length}/${total} workspace(s) with changes since "${label}"${dependentsNote}`));

  if (affected.length === 0) {
    console.log(dim("No eligible workspace changed."));
  }
}

export function printJunitReport({ destination, missing, error }) {
  if (missing.length > 0) {
    console.log(dim(`${missing.length} workspace(s) missing from the JUnit report: ${missing.join(", ")}`));
  }
  if (error) {
    console.error(red(`Could not write JUnit report to "${destination}" (${error.message})`));
  }
}

export function printWatchRerun(changedPaths, affected) {
  const changedNames = [...changedPaths].map(workspaceName).join(", ");
  const affectedNames = affected.map((workspace) => workspace.name).join(", ");
  console.log(dim(`\n[watch] change detected in ${changedNames} → re-running: ${affectedNames}\n`));
}

export function printWatchStopping() {
  console.log(dim("\n[watch] stopping.\n"));
}

export function printOwnReporterSkips(scriptName, workspaces) {
  for (const workspace of workspaces) {
    console.log(dim(`⊘ ${workspace.name}: skipped, own --test-reporter detected in its "${scriptName}" script`));
  }
}

export function printNothingToRun(scriptName, ownReporterConflicts) {
  console.log(dim(ownReporterConflicts.length > 0
    ? `All workspaces with a "${scriptName}" script were skipped (own --test-reporter detected).`
    : `No workspace has a "${scriptName}" script.`));
}

export function printNoJunitWritten(junitPath) {
  console.log(dim(`--junit: no report written to "${junitPath}" (no workspace ran)`));
}
