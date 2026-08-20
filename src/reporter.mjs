import { styleText } from "node:util";

export const green = (str) => styleText("green", str);
export const red = (str) => styleText("red", str);
export const dim = (str) => styleText("dim", str);
export const bold = (str) => styleText("bold", str);

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

export function workspaceName(wsPath) {
  return (wsPath ?? "").replace(/^workspaces[\\/]/, "");
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

export function printWorkspaceResult(name, result, ciGroup) {
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
    fail: counts?.fail ?? "-",
    skip: counts?.skip ?? "-",
    todo: counts?.todo ?? "-",
    cancelled: counts?.cancelled ?? "-"
  };
}

export function printSummary(results, skipped) {
  console.log(bold("\nSummary"));

  const rows = {};
  for (const { wsPath, exitCode, durationMs, counts } of results) {
    rows[workspaceName(wsPath)] = summaryRow(exitCode === 0 ? "PASS" : "FAIL", formatSeconds(durationMs), counts);
  }
  for (const wsPath of skipped) {
    rows[workspaceName(wsPath)] = summaryRow("SKIPPED", "-", null);
  }

  console.table(rows);

  if (skipped.length > 0) {
    console.log(dim(`${skipped.length} workspace(s) skipped (--ff): ${skipped.map(workspaceName).join(", ")}`));
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
    console.log(red(`  ${workspaceName(result.wsPath)}`));
    for (const testName of result.failingTests) {
      console.log(dim(`    ✖ ${testName}`));
    }
  }
  process.exitCode = 1;
}
