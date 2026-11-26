import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { dim, workspaceName, printSummary, reportOutcome } from "./reporter.mjs";
import { resolveWorkspacePaths, loadWorkspaces } from "./workspaces.mjs";
import { runWorkspaces } from "./schedule.mjs";
import { writeJunitReport } from "./junitReport.mjs";
import { filterChangedWorkspaces } from "./changed.mjs";
import { watchAndRerun } from "./watch.mjs";

async function runOnce(options, workspaces, junitPath) {
  const junitDir = junitPath ? await mkdtemp(path.join(tmpdir(), "sumlyzer-junit-")) : null;

  let completed, skipped;
  try {
    ({ completed, skipped } = await runWorkspaces({ ...options, workspaces, junitDir }));

    if (junitDir) {
      await writeJunitReport(options.root, junitPath, completed);
    }
  }
  finally {
    if (junitDir) {
      await rm(junitDir, { recursive: true, force: true });
    }
  }

  printSummary(completed, skipped);
  reportOutcome(completed);
}

function reportOwnReporterSkips(scriptName, ownReporterConflicts) {
  for (const wsPath of ownReporterConflicts) {
    console.log(dim(`⊘ ${workspaceName(wsPath)}: skipped, own --test-reporter detected in its "${scriptName}" script`));
  }
}

export async function main({ root, scriptName, ff, junitPath, concurrency = 1, changed = false, ref, watch = false }) {
  const options = { root, scriptName, ff, concurrency };

  const allPaths = await resolveWorkspacePaths(root);
  const { runnable, ownReporterConflicts } = loadWorkspaces(root, allPaths, scriptName);

  reportOwnReporterSkips(scriptName, ownReporterConflicts);

  if (runnable.length === 0) {
    console.log(dim(ownReporterConflicts.length > 0
      ? `All workspaces with a "${scriptName}" script were skipped (own --test-reporter detected).`
      : `No workspace has a "${scriptName}" script.`));
    return;
  }

  let workspaces = runnable;
  if (changed) {
    workspaces = filterChangedWorkspaces({ root, allPaths, workspaces, ref });
    if (workspaces === null) {
      if (junitPath) {
        console.log(dim(`--junit: no report written to "${junitPath}" (no workspace ran)`));
      }
      return;
    }
  }

  await runOnce(options, workspaces, junitPath);

  if (watch) {
    await watchAndRerun({ root, allPaths, workspaces, rerun: (affected) => runOnce(options, affected) });
  }
}
