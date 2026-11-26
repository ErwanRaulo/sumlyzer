import { watch } from "node:fs";
import path from "node:path";

import { buildDependentsGraph, expandWithDependents } from "./graph.mjs";

const IGNORED_SEGMENTS = new Set(["node_modules", "coverage", ".git"]);

function isIgnored(relPath) {
  return relPath.split(path.sep).some((segment) => IGNORED_SEGMENTS.has(segment) || segment.startsWith("."));
}

function matchWorkspace(relPath, workspaces) {
  const normalized = relPath.split(path.sep).join("/");
  return workspaces.find((wsPath) => normalized === wsPath || normalized.startsWith(`${wsPath}/`));
}

function watchWorkspaces({ root, workspaces, onChange, isSuppressed, debounceMs = 300 }) {
  const pending = new Set();
  let timer = null;

  const watcher = watch(root, { recursive: true }, (eventType, filename) => {
    if (!filename || isIgnored(filename)) {
      return;
    }

    const wsPath = matchWorkspace(filename, workspaces);
    if (!wsPath || isSuppressed(wsPath)) {
      return;
    }

    pending.add(wsPath);
    clearTimeout(timer);
    timer = setTimeout(() => {
      const changed = new Set(pending);
      pending.clear();
      onChange(changed);
    }, debounceMs);
  });

  return {
    close() {
      clearTimeout(timer);
      watcher.close();
    }
  };
}

// A run can write files inside its own workspace (coverage, artifacts) just after it
// exits; ignoring them briefly stops the workspace from re-triggering itself forever.
const SETTLE_COOLDOWN_MS = 500;

/**
 * Calls `rerun(affected, changedPaths)` on each change, with the changed workspaces
 * and their dependents, until SIGINT/SIGTERM.
 * @returns {Promise<void>}
 */
export function watchAndRerun({ root, allPaths, workspaces, rerun }) {
  const dependentsGraph = buildDependentsGraph(root, allPaths);
  const byPath = new Map(workspaces.map((workspace) => [workspace.path, workspace]));
  const settling = new Set();

  async function onChange(changedPaths) {
    const affected = [...expandWithDependents(changedPaths, dependentsGraph)]
      .map((wsPath) => byPath.get(wsPath))
      .filter(Boolean);
    if (affected.length === 0) {
      return;
    }

    for (const workspace of affected) {
      settling.add(workspace.path);
    }
    try {
      await rerun(affected, changedPaths);
    }
    finally {
      setTimeout(() => {
        for (const workspace of affected) {
          settling.delete(workspace.path);
        }
      }, SETTLE_COOLDOWN_MS).unref();
    }
  }

  const watcher = watchWorkspaces({ root, workspaces: allPaths, isSuppressed: (wsPath) => settling.has(wsPath), onChange });

  return new Promise((resolve) => {
    const stop = () => {
      watcher.close();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}
