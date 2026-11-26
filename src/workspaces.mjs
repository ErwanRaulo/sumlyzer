import { readFileSync } from "node:fs";
import path from "node:path";

import { glob } from "glob";

import { runner } from "./runner.mjs";
import { NoWorkspacesError, InvalidPackageJsonError, RootPackageJsonError } from "./errors.mjs";

export function workspaceName(wsPath) {
  return (wsPath ?? "").replace(/^workspaces[\\/]/, "");
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// npm's interpretation of "workspaces": directory globs, "!" entries excluded.
function splitWorkspacePatterns(entries) {
  const patterns = [];
  const ignore = ["**/node_modules/**"];

  for (const entry of entries) {
    if (entry.startsWith("!")) {
      ignore.push(entry.slice(1));
    }
    else {
      patterns.push(entry.endsWith("/") ? entry : `${entry}/`);
    }
  }

  return { patterns, ignore };
}

export async function resolveWorkspacePaths(root) {
  let rootPkg;
  try {
    rootPkg = readJson(path.join(root, "package.json"));
  }
  catch (error) {
    throw new RootPackageJsonError(root, error);
  }

  if (!rootPkg.workspaces || rootPkg.workspaces.length === 0) {
    throw new NoWorkspacesError();
  }

  const { patterns, ignore } = splitWorkspacePatterns(rootPkg.workspaces);
  const resolved = new Set();

  for (const pattern of patterns) {
    // posix: "/" separators on Windows too, like git and fs.watch.
    const matches = await glob(pattern, { cwd: root, ignore, posix: true });

    for (const match of matches.sort((a, b) => a.localeCompare(b, "en"))) {
      resolved.add(match);
    }
  }

  return [...resolved];
}

// pre/post hooks run like npm run does, around the main script.
function scriptPhases(scripts, scriptName) {
  return [
    { event: `pre${scriptName}`, command: scripts[`pre${scriptName}`] },
    { event: scriptName, command: scripts[scriptName], isMain: true },
    { event: `post${scriptName}`, command: scripts[`post${scriptName}`] }
  ].filter((phase) => phase.command);
}

function loadWorkspace(root, wsPath, scriptName) {
  const workspace = { path: wsPath, name: workspaceName(wsPath), pkg: null, phases: [] };
  try {
    workspace.pkg = readJson(path.join(root, wsPath, "package.json"));
  }
  catch (error) {
    return error.code === "ENOENT" ? { kind: "absent", workspace } : { kind: "invalid", workspace, message: error.message };
  }

  if (!workspace.pkg.scripts?.[scriptName]) {
    return { kind: "absent", workspace };
  }

  workspace.phases = scriptPhases(workspace.pkg.scripts, scriptName);
  const kind = workspace.phases.some((phase) => runner.hasOwnReporter(phase.command)) ? "ownReporterConflict" : "runnable";
  return { kind, workspace };
}

export function loadWorkspaces(root, wsPaths, scriptName) {
  const runnable = [];
  const ownReporterConflicts = [];
  const invalid = [];

  for (const wsPath of wsPaths) {
    const loaded = loadWorkspace(root, wsPath, scriptName);
    if (loaded.kind === "runnable") {
      runnable.push(loaded.workspace);
    }
    else if (loaded.kind === "ownReporterConflict") {
      ownReporterConflicts.push(loaded.workspace);
    }
    else if (loaded.kind === "invalid") {
      invalid.push({ workspace: loaded.workspace, message: loaded.message });
    }
  }

  if (invalid.length > 0) {
    throw new InvalidPackageJsonError(invalid);
  }

  return { runnable, ownReporterConflicts };
}
