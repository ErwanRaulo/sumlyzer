import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import * as reporter from "./reporter.mjs";
import { resolveWorkspacePaths, loadWorkspaces } from "./workspaces.mjs";
import { runWorkspaces } from "./schedule.mjs";
import { writeJunitReport } from "./junitReport.mjs";
import { resolveChangedRef, selectAffectedWorkspaces } from "./changed.mjs";
import { watchAndRerun } from "./watch.mjs";

async function runOnce(options, workspaces, junitPath) {
  const junitDir = junitPath ? await mkdtemp(path.join(tmpdir(), "sumlyzer-junit-")) : null;
  const ciGroup = reporter.githubGroupSyntax(process.env);

  let completed, skipped;
  try {
    ({ completed, skipped } = await runWorkspaces({
      ...options,
      workspaces,
      junitDir,
      onStart: (workspace) => reporter.printWorkspaceStart(workspace.name),
      onResult: (workspace, result) => reporter.printWorkspaceResult(workspace.name, result, ciGroup)
    }));

    if (junitDir) {
      const junit = await writeJunitReport(options.root, junitPath, completed);
      reporter.printJunitReport(junit);
      if (junit.error) {
        process.exitCode = 1;
      }
    }
  }
  finally {
    if (junitDir) {
      await rm(junitDir, { recursive: true, force: true });
    }
  }

  reporter.printSummary(completed, skipped);
  reporter.reportOutcome(completed);
}

// Returns the workspaces to run, or null when nothing changed.
function selectChanged({ root, allPaths, workspaces, ref }) {
  const changedRef = resolveChangedRef(root, ref);
  reporter.printChangedRef(changedRef);

  const selection = selectAffectedWorkspaces({ root, allPaths, workspaces, ref: changedRef.ref });
  reporter.printChangedSelection({ label: changedRef.label, total: workspaces.length, selection });

  return selection.affected.length > 0 ? selection.affected : null;
}

export async function main({ root, scriptName, ff, junitPath, concurrency = 1, changed = false, ref, watch = false }) {
  const options = { root, scriptName, ff, concurrency };

  const allPaths = await resolveWorkspacePaths(root);
  const { runnable, ownReporterConflicts } = loadWorkspaces(root, allPaths, scriptName);

  reporter.printOwnReporterSkips(scriptName, ownReporterConflicts);
  if (runnable.length === 0) {
    reporter.printNothingToRun(scriptName, ownReporterConflicts);
    return;
  }

  let workspaces = runnable;
  if (changed) {
    workspaces = selectChanged({ root, allPaths, workspaces, ref });
    if (workspaces === null) {
      if (junitPath) {
        reporter.printNoJunitWritten(junitPath);
      }
      return;
    }
  }

  await runOnce(options, workspaces, junitPath);

  if (watch) {
    await watchAndRerun({
      root,
      allPaths,
      workspaces,
      rerun: (affected, changedPaths) => {
        reporter.printWatchRerun(changedPaths, affected);
        return runOnce(options, affected);
      }
    });
    reporter.printWatchStopping();
  }
}
