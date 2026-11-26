import path from "node:path";

import { WorkspaceLaunchError } from "./errors.mjs";
import { killAll, runWorkspace, withInterruptHandling } from "./workspaceProcess.mjs";

// A slot left undefined never started (--ff stopped scheduling first): skipped.
function partitionResults(results, workspaces) {
  const completed = [];
  const skipped = [];
  for (const [index, result] of results.entries()) {
    if (result === undefined) {
      skipped.push(workspaces[index]);
    }
    else {
      completed.push(result);
    }
  }

  return { completed, skipped };
}

export async function runWorkspaces({ root, workspaces, scriptName, ff, concurrency, junitDir, onStart, onResult }) {
  const results = new Array(workspaces.length);
  const activeChildren = new Set();
  let stopScheduling = false;
  let nextIndex = 0;

  async function worker() {
    while (!stopScheduling && nextIndex < workspaces.length) {
      const index = nextIndex++;
      const workspace = workspaces[index];
      onStart(workspace);

      const junitDestPath = junitDir ? path.join(junitDir, `${index}.xml`) : undefined;

      let result;
      try {
        result = await runWorkspace({ root, workspace, junitDestPath, activeChildren });
      }
      catch (error) {
        stopScheduling = true;
        killAll(activeChildren);
        throw new WorkspaceLaunchError(workspace, scriptName, error);
      }
      results[index] = result;
      onResult(workspace, result);

      if (result.exitCode !== 0 && ff) {
        stopScheduling = true;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, workspaces.length));
  await withInterruptHandling(activeChildren, () => Promise.all(Array.from({ length: workerCount }, worker)));

  return partitionResults(results, workspaces);
}
