import { spawnSync } from "node:child_process";

import { GitDiffError } from "./errors.mjs";
import { buildDependentsGraph, expandWithDependents } from "./graph.mjs";
import { dim } from "./reporter.mjs";

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

function resolveRef(root, explicitRef) {
  if (explicitRef) {
    return { ref: explicitRef, label: explicitRef };
  }

  const resolved = resolveDefaultRef(root);
  console.log(dim(`--changed: no --ref given, comparing against "${resolved.label}" (${resolved.reason})`));
  return resolved;
}

// Returns the changed workspaces and their dependents, or null when there's nothing to run (already reported).
export function filterChangedWorkspaces({ root, allPaths, workspaces, ref: explicitRef }) {
  const { ref, label } = resolveRef(root, explicitRef);

  const changedFiles = getChangedFiles(root, ref);
  if (changedFiles.length === 0) {
    console.log(dim(`No changes detected against "${label}".`));
    return null;
  }

  const { workspaces: changedPaths, rootChangeFiles } = selectChangedWorkspaces(allPaths, changedFiles);

  if (rootChangeFiles.length > 0) {
    const suffix = rootChangeFiles.length > 1 ? ` (+${rootChangeFiles.length - 1} more)` : "";
    console.log(dim(`--changed: "${rootChangeFiles[0]}"${suffix} is outside every workspace, ignoring`));
  }

  const affectedPaths = expandWithDependents(changedPaths, buildDependentsGraph(root, allPaths));
  const filtered = workspaces.filter((workspace) => affectedPaths.has(workspace.path));
  const dependents = filtered.filter((workspace) => !changedPaths.has(workspace.path)).map((workspace) => workspace.name);
  const dependentsNote = dependents.length > 0 ? ` (incl. dependents: ${dependents.join(", ")})` : "";
  console.log(dim(`--changed: running ${filtered.length}/${workspaces.length} workspace(s) with changes since "${label}"${dependentsNote}`));

  if (filtered.length === 0) {
    console.log(dim("No eligible workspace changed."));
    return null;
  }

  return filtered;
}
