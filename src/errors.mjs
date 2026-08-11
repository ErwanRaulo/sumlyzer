import { red, workspaceName } from "./reporter.mjs";

export class NoWorkspacesError extends Error {
  constructor() {
    super("Your project does not have any workspaces.");
    this.name = "NoWorkspacesError";
  }
}

export class InvalidPackageJsonError extends Error {
  constructor(entries) {
    super(entries.map(({ wsPath, message }) => red(`✗ ${workspaceName(wsPath)}: could not read its package.json (${message})`)).join("\n"));
    this.name = "InvalidPackageJsonError";
    this.entries = entries;
  }
}

export class WorkspaceLaunchError extends Error {
  constructor(wsPath, scriptName, cause) {
    super(red(`✗ ${workspaceName(wsPath)}: could not launch "${scriptName}" (${cause.message})`), { cause });
    this.name = "WorkspaceLaunchError";
    this.wsPath = wsPath;
    this.scriptName = scriptName;
  }
}
