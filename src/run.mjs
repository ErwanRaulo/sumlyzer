import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildJunitReport } from "./junit.mjs";
import { red, dim, workspaceName, githubGroupSyntax, printWorkspaceResult, printSummary, reportOutcome } from "./reporter.mjs";
import { NoWorkspacesError, InvalidPackageJsonError, WorkspaceLaunchError } from "./errors.mjs";
import { hasOwnReporter, prepareEnv, parseResult } from "./runners/nodeTest.mjs";

const runner = { hasOwnReporter, prepareEnv, parseResult };

// Rethink this synchronous approach in case of very large package.json files, or huge amount of workspaces,
// but for now it's simpler than async and should be fine in practice.
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function listEligibleWorkspaces(root, workspaces, scriptName) {
  const eligible = [];
  const ownReporterConflicts = [];
  const invalidPackageJson = [];

  for (const wsPath of workspaces) {
    const pkgFile = path.join(root, wsPath, "package.json");
    let pkg;
    try {
      pkg = readJson(pkgFile);
    }
    catch (error) {
      if (error.code === "ENOENT") {
        continue;
      }
      invalidPackageJson.push({ wsPath, message: error.message });
      continue;
    }

    const script = pkg.scripts?.[scriptName];
    if (!script) {
      continue;
    }
    if (runner.hasOwnReporter(script)) {
      ownReporterConflicts.push(wsPath);
    }
    else {
      eligible.push(wsPath);
    }
  }

  return { eligible, ownReporterConflicts, invalidPackageJson };
}

// npm spawns the actual test runner as its own child, so killing just the "npm"
// process leaves that grandchild running. Giving it its own process group (POSIX)
// or asking Windows to kill the whole tree ensures nothing is left behind.
function killWorkspaceChild(child) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  }
  catch {
    child.kill("SIGTERM");
  }
}

async function captureWorkspaceOutput({ root, wsPath, scriptName, junitDestPath, activeChildren }) {
  const options = {
    cwd: root,
    shell: process.platform === "win32",
    detached: process.platform !== "win32",
    env: runner.prepareEnv(process.env, junitDestPath)
  };

  const child = spawn("npm", ["run", scriptName, "--workspace=" + wsPath], options);
  activeChildren.add(child);
  const stdoutChunks = [];
  const stderrChunks = [];

  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  try {
    const exitCode = await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });

    return {
      exitCode,
      stdout: Buffer.concat(stdoutChunks).toString("utf8"),
      stderr: Buffer.concat(stderrChunks).toString("utf8")
    };
  }
  finally {
    activeChildren.delete(child);
  }
}

function killActiveChildren(activeChildren) {
  for (const child of activeChildren) {
    killWorkspaceChild(child);
  }
}

async function withInterruptHandling(activeChildren, run) {
  function onInterrupt(signal) {
    killActiveChildren(activeChildren);
    process.exit(signal === "SIGINT" ? 130 : 143);
  }

  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  try {
    return await run();
  }
  finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
  }
}

async function runWorkspaceScript({ root, wsPath, scriptName, junitDestPath, activeChildren }) {
  const start = Date.now();
  const captured = await captureWorkspaceOutput({ root, wsPath, scriptName, junitDestPath, activeChildren });

  return {
    wsPath,
    exitCode: captured.exitCode,
    durationMs: Date.now() - start,
    junitDestPath,
    ...runner.parseResult(captured)
  };
}

async function collectJunitEntries(results) {
  const entries = [];
  const missing = [];

  for (const result of results) {
    if (!result.junitDestPath) {
      continue;
    }
    try {
      entries.push({ name: workspaceName(result.wsPath), xml: await readFile(result.junitDestPath, "utf8") });
    }
    catch {
      missing.push(workspaceName(result.wsPath));
    }
  }

  return { entries, missing };
}

async function runWorkspaces({ root, workspacesToRun, scriptName, ff, junitDir, concurrency }) {
  const results = new Array(workspacesToRun.length);
  const ciGroup = githubGroupSyntax(process.env);
  const activeChildren = new Set();
  let stopScheduling = false;
  let nextIndex = 0;


  async function worker() {
    while (!stopScheduling && nextIndex < workspacesToRun.length) {
      const index = nextIndex++;
      const wsPath = workspacesToRun[index];
      const name = workspaceName(wsPath);
      process.stdout.write(dim(`running ${name}\n`));

      const junitDestPath = junitDir ? path.join(junitDir, `${index}.xml`) : undefined;

      let result;
      try {
        result = await runWorkspaceScript({ root, wsPath, scriptName, junitDestPath, activeChildren });
      }
      catch (error) {
        stopScheduling = true;
        killActiveChildren(activeChildren);
        throw new WorkspaceLaunchError(wsPath, scriptName, error);
      }
      results[index] = result;
      printWorkspaceResult(name, result, ciGroup);

      if (result.exitCode !== 0 && ff) {
        stopScheduling = true;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, workspacesToRun.length));
  await withInterruptHandling(activeChildren, () => Promise.all(Array.from({ length: workerCount }, worker)));

  const completed = [];
  const skipped = [];
  for (const [index, result] of results.entries()) {
    if (result === undefined) {
      skipped.push(workspacesToRun[index]);
    }
    else {
      completed.push(result);
    }
  }

  return { completed, skipped };
}

const DEFAULT_JUNIT_FILENAME = "junit.xml";

async function resolveJunitDestination(root, junitPath) {
  const destination = path.resolve(root, junitPath);
  const isExistingDirectory = await stat(destination).then((stats) => stats.isDirectory(), () => false);

  return isExistingDirectory ? path.join(destination, DEFAULT_JUNIT_FILENAME) : destination;
}

async function writeJunitReport(root, junitPath, results) {
  const { entries, missing } = await collectJunitEntries(results);
  const destination = await resolveJunitDestination(root, junitPath);

  if (missing.length > 0) {
    console.log(dim(`${missing.length} workspace(s) missing from the JUnit report: ${missing.join(", ")}`));
  }

  try {
    await writeFile(destination, buildJunitReport(entries));
  }
  catch (error) {
    console.error(red(`Could not write JUnit report to "${destination}" (${error.message})`));
    process.exitCode = 1;
  }
}

export async function main({ root, scriptName, ff, junitPath, concurrency = 1 }) {

  const { workspaces } = readJson(path.join(root, "package.json"));

  if (!workspaces || workspaces.length === 0) {
    throw new NoWorkspacesError();
  }

  const { eligible: workspacesToRun, ownReporterConflicts, invalidPackageJson } = listEligibleWorkspaces(root, workspaces, scriptName);

  if (invalidPackageJson.length > 0) {
    throw new InvalidPackageJsonError(invalidPackageJson);
  }

  for (const wsPath of ownReporterConflicts) {
    console.log(dim(`⊘ ${workspaceName(wsPath)}: skipped, own --test-reporter detected in its "${scriptName}" script`));
  }

  const junitDir = junitPath ? await mkdtemp(path.join(tmpdir(), "sumlyzer-junit-")) : null;

  let completed, skipped;
  try {
    ({ completed, skipped } = await runWorkspaces({ root, workspacesToRun, scriptName, ff, junitDir, concurrency }));

    if (junitDir) {
      await writeJunitReport(root, junitPath, completed);
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
