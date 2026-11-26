import { spawnSync } from "node:child_process";

import { GitDiffError } from "./errors.mjs";
import { buildDependentsGraph, expandWithDependents } from "./graph.mjs";

function runGit(root, args, ref) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });

  if (result.error) {
    throw new GitDiffError(ref, result.error.message);
  }
  if (result.status !== 0) {
    throw new GitDiffError(ref, result.stderr.trim() || `git exited with code ${result.status}`);
  }

  return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
}

function tryGit(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}

export function getChangedFiles(root, ref) {
  // The ref can't be read as an option (--end-of-options) or a pathspec (--).
  const tracked = runGit(root, ["diff", "--name-only", "--end-of-options", ref, "--"], ref);
  const untracked = runGit(root, ["ls-files", "--others", "--exclude-standard"], ref);

  return [...new Set([...tracked, ...untracked])];
}

export function resolveDefaultRef(root) {
  const dirty = runGit(root, ["status", "--porcelain"], "auto-detected");
  if (dirty.length > 0) {
    return { ref: "HEAD", label: "HEAD", reason: "uncommitted changes" };
  }

  const upstream = tryGit(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream) {
    return { ref: "HEAD", label: "HEAD", reason: "no upstream configured" };
  }

  const mergeBase = tryGit(root, ["merge-base", upstream, "HEAD"]);
  if (mergeBase) {
    return { ref: mergeBase, label: `merge-base with "${upstream}"`, reason: "no local changes" };
  }

  return { ref: upstream, label: upstream, reason: "no merge-base found" };
}

// Maps each changed file to its innermost workspace; the rest are root changes.
export function selectChangedWorkspaces(resolvedWorkspaces, changedFiles) {
  const sorted = [...resolvedWorkspaces].sort((a, b) => b.length - a.length);
  const workspaces = new Set();
  const rootChangeFiles = [];

  for (const file of changedFiles) {
    const owner = sorted.find((wsPath) => file === wsPath || file.startsWith(`${wsPath}/`));
    if (owner) {
      workspaces.add(owner);
    }
    else {
      rootChangeFiles.push(file);
    }
  }

  return { workspaces, rootChangeFiles };
}

export function resolveChangedRef(root, explicitRef) {
  return explicitRef
    ? { ref: explicitRef, label: explicitRef, reason: null, autoDetected: false }
    : { ...resolveDefaultRef(root), autoDetected: true };
}

// The workspaces changed since `ref`, plus their dependents.
export function selectAffectedWorkspaces({ root, allPaths, workspaces, ref }) {
  const changedFiles = getChangedFiles(root, ref);
  const { workspaces: changedPaths, rootChangeFiles } = selectChangedWorkspaces(allPaths, changedFiles);
  const affectedPaths = expandWithDependents(changedPaths, buildDependentsGraph(root, allPaths));
  const affected = workspaces.filter((workspace) => affectedPaths.has(workspace.path));

  return {
    hasChanges: changedFiles.length > 0,
    rootChangeFiles,
    affected,
    dependents: affected.filter((workspace) => !changedPaths.has(workspace.path)).map((workspace) => workspace.name)
  };
}
