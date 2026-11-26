import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolveWorkspacePaths, loadWorkspaces } from "./workspaces.mjs";
import { runWorkspaces } from "./schedule.mjs";
import { writeJunitReport } from "./junitReport.mjs";
import { resolveChangedRef, selectAffectedWorkspaces } from "./changed.mjs";
import { watchAndRerun } from "./watch.mjs";

// Returns whether the run failed: a workspace failed or the JUnit report couldn't be written.
async function runOnce({ options, reporter, workspaces, junitPath }) {
  const junitDir = junitPath ? await mkdtemp(path.join(tmpdir(), "sumlyzer-junit-")) : null;

  let completed, skipped, junit;
  try {
    ({ completed, skipped } = await runWorkspaces({
      ...options,
      workspaces,
      junitDir,
      onStart: (workspace) => reporter.printWorkspaceStart(workspace.name),
      onResult: (workspace, result) => reporter.printWorkspaceResult(workspace.name, result)
    }));

    if (junitDir) {
      junit = await writeJunitReport(options.root, junitPath, completed);
      reporter.printJunitReport(junit);
    }
  }
  finally {
    if (junitDir) {
      await rm(junitDir, { recursive: true, force: true });
    }
  }

  reporter.printSummary(completed, skipped);
  reporter.reportOutcome(completed);

  return completed.some((result) => result.exitCode !== 0) || Boolean(junit?.error);
}

// Returns the workspaces to run, or null when nothing changed.
function selectChanged({ reporter, root, allPaths, workspaces, ref }) {
  const changedRef = resolveChangedRef(root, ref);
  reporter.printChangedRef(changedRef);

  const selection = selectAffectedWorkspaces({ root, allPaths, workspaces, ref: changedRef.ref });
  reporter.printChangedSelection({ label: changedRef.label, total: workspaces.length, selection });

  return selection.affected.length > 0 ? selection.affected : null;
}

/**
 * @param {object} params
 * @param {string} params.root
 * @param {string} params.scriptName
 * @param {boolean} params.ff
 * @param {string} [params.junitPath]
 * @param {number} [params.concurrency]
 * @param {boolean} [params.changed]
 * @param {string} [params.ref]
 * @param {boolean} [params.watch]
 * @param {typeof import("./reporter.mjs")} params.reporter output for every step
 * @returns {Promise<{ failed: boolean }>}
 */
export async function main({ root, scriptName, ff, junitPath, concurrency = 1, changed = false, ref, watch = false, reporter }) {
  const options = { root, scriptName, ff, concurrency };

  const allPaths = await resolveWorkspacePaths(root);
  const { runnable, ownReporterConflicts } = loadWorkspaces(root, allPaths, scriptName);

  reporter.printOwnReporterSkips(scriptName, ownReporterConflicts);
  if (runnable.length === 0) {
    reporter.printNothingToRun(scriptName, ownReporterConflicts);
    return { failed: false };
  }

  let workspaces = runnable;
  if (changed) {
    workspaces = selectChanged({ reporter, root, allPaths, workspaces, ref });
    if (workspaces === null) {
      if (junitPath) {
        reporter.printNoJunitWritten(junitPath);
      }
      return { failed: false };
    }
  }

  let failed = await runOnce({ options, reporter, workspaces, junitPath });

  if (watch) {
    await watchAndRerun({
      root,
      allPaths,
      workspaces,
      rerun: async (affected, changedPaths) => {
        reporter.printWatchRerun(changedPaths, affected);
        failed = (await runOnce({ options, reporter, workspaces: affected, junitPath: undefined })) || failed;
      }
    });
    reporter.printWatchStopping();
  }

  return { failed };
}
