import { workspaceName } from "./reporter.mjs";

export class NoWorkspacesError extends Error {
  constructor() {
    super("Your project does not have any workspaces.");
    this.name = "NoWorkspacesError";
  }
}

export class RootPackageJsonError extends Error {
  constructor(root, cause) {
    super(cause.code === "ENOENT"
      ? `No package.json found in ${root}. Run sumlyzer from the root of an npm workspaces project.`
      : `could not read the root package.json (${cause.message})`, { cause });
    this.name = "RootPackageJsonError";
  }
}

export class InvalidPackageJsonError extends Error {
  constructor(entries) {
    super(entries.map(({ wsPath, message }) => `${workspaceName(wsPath)}: could not read its package.json (${message})`).join("\n"));
    this.name = "InvalidPackageJsonError";
    this.entries = entries;
  }
}

export class WorkspaceLaunchError extends Error {
  constructor(wsPath, scriptName, cause) {
    super(`${workspaceName(wsPath)}: could not launch "${scriptName}" (${cause.message})`, { cause });
    this.name = "WorkspaceLaunchError";
    this.wsPath = wsPath;
    this.scriptName = scriptName;
  }
}

export class GitDiffError extends Error {
  constructor(ref, reason) {
    super(`could not compute changed files against "${ref}" (${reason})`);
    this.name = "GitDiffError";
    this.ref = ref;
  }
}
