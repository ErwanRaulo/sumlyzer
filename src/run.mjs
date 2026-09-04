import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { glob } from "glob";

import { buildJunitReport } from "./junit.mjs";
import { buildDependentsGraph, expandWithDependents } from "./graph.mjs";
import { watchWorkspaces } from "./watch.mjs";
import { red, dim, workspaceName, githubGroupSyntax, printWorkspaceResult, printSummary, reportOutcome } from "./reporter.mjs";
import { NoWorkspacesError, InvalidPackageJsonError, WorkspaceLaunchError } from "./errors.mjs";
import { hasOwnReporter, prepareEnv, parseResult } from "./runners/nodeTest.mjs";
import { getChangedFiles, resolveDefaultRef, selectChangedWorkspaces } from "./changed.mjs";

const runner = { hasOwnReporter, prepareEnv, parseResult };

function log(quiet, message) {
  if (!quiet) {
    console.log(message);
  }
}

// Rethink this synchronous approach in case of very large package.json files, or huge amount of workspaces,
// but for now it's simpler than async and should be fine in practice.
function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

// Splits "workspaces" entries into directory-only glob patterns to include and
// (from any leading "!") patterns to exclude, matching npm's own interpretation
// of the field.
function splitWorkspacePatterns(workspaces) {
  const patterns = [];
  const ignore = ["**/node_modules/**"];

  for (const entry of workspaces) {
    if (entry.startsWith("!")) {
      ignore.push(entry.slice(1));
    }
    else {
      patterns.push(entry.endsWith("/") ? entry : `${entry}/`);
    }
  }

  return { patterns, ignore };
}

// The "workspaces" field holds glob patterns (e.g. "packages/*"), not necessarily
// concrete paths. Resolve it the same way npm itself does: glob each pattern
// against directories only, in declaration order.
async function resolveWorkspacePaths(root, workspaces) {
  const { patterns, ignore } = splitWorkspacePatterns(workspaces);
  const resolved = new Set();

  for (const pattern of patterns) {
    const matches = await glob(pattern, { cwd: root, ignore });

    for (const match of matches.sort((a, b) => a.localeCompare(b, "en"))) {
      resolved.add(match);
    }
  }

  return [...resolved];
}

function classifyWorkspace(root, wsPath, scriptName) {
  const pkgFile = path.join(root, wsPath, "package.json");
  let pkg;
  try {
    pkg = readJson(pkgFile);
  }
  catch (error) {
    return error.code === "ENOENT" ? { kind: "absent" } : { kind: "invalid", message: error.message };
  }

  const script = pkg.scripts?.[scriptName];
  if (!script) {
    return { kind: "absent" };
  }

  const pre = pkg.scripts?.[`pre${scriptName}`];
  const post = pkg.scripts?.[`post${scriptName}`];

  const hasConflict = [pre, script, post].some((command) => command && runner.hasOwnReporter(command));
  return hasConflict ? { kind: "ownReporterConflict" } : { kind: "eligible", pre, script, post };
}

function listEligibleWorkspaces(root, workspaces, scriptName) {
  const eligible = [];
  const ownReporterConflicts = [];
  const invalidPackageJson = [];
  const scriptCommands = new Map();

  for (const wsPath of workspaces) {
    const classification = classifyWorkspace(root, wsPath, scriptName);
    switch (classification.kind) {
      case "invalid":
        invalidPackageJson.push({ wsPath, message: classification.message });
        break;
      case "ownReporterConflict":
        ownReporterConflicts.push(wsPath);
        break;
      case "eligible":
        eligible.push(wsPath);
        scriptCommands.set(wsPath, { pre: classification.pre, script: classification.script, post: classification.post });
        break;
    }
  }

  return { eligible, ownReporterConflicts, invalidPackageJson, scriptCommands };
}

function buildWorkspacePath(root, wsPath) {
  const rootDir = path.resolve(root);
  const binDirs = [];
  let dir = path.resolve(root, wsPath);

  while (true) {
    binDirs.push(path.join(dir, "node_modules", ".bin"));
    if (dir === rootDir) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return [...binDirs, path.dirname(process.execPath), process.env.PATH].join(path.delimiter);
}

// The spawned shell is the actual test runner's parent, so killing just it
// leaves that grandchild running. Giving it its own process group (POSIX)
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

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function runPhase(command, options, activeChildren) {
  const child = spawn(command, options);
  activeChildren.add(child);
  const stdoutChunks = [];
  const stderrChunks = [];

  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

  try {
    const exitCode = await waitForExit(child);
    return { exitCode, stdoutChunks, stderrChunks };
  }
  finally {
    activeChildren.delete(child);
  }
}

// Only the main script gets sumlyzer's own node:test reporter forced onto it via
// NODE_OPTIONS. pre/post run with a plain environment: forcing our JSON reporter onto
// them too would let a hook that happens to run its own `node --test` silently overwrite
// the main script's parsed counts/JUnit report with its own, whichever phase runs last.
function buildPhaseOptions({ root, wsPath, junitDestPath }) {
  const cwd = path.join(root, wsPath);
  const PATH = buildWorkspacePath(root, wsPath);
  const shellOptions = { cwd, shell: true, detached: process.platform !== "win32" };

  return {
    hook: { ...shellOptions, env: { ...process.env, PATH } },
    script: { ...shellOptions, env: { ...runner.prepareEnv(process.env, junitDestPath), PATH } }
  };
}

async function captureWorkspaceOutput({ root, wsPath, scriptPhases, junitDestPath, activeChildren }) {
  const phaseOptions = buildPhaseOptions({ root, wsPath, junitDestPath });

  const phases = [
    scriptPhases.pre && { command: scriptPhases.pre, options: phaseOptions.hook },
    { command: scriptPhases.script, options: phaseOptions.script },
    scriptPhases.post && { command: scriptPhases.post, options: phaseOptions.hook }
  ].filter(Boolean);

  const stdoutChunks = [];
  const stderrChunks = [];
  let exitCode = 0;

  for (const { command, options } of phases) {
    const phase = await runPhase(command, options, activeChildren);
    exitCode = phase.exitCode;
    stdoutChunks.push(...phase.stdoutChunks);
    stderrChunks.push(...phase.stderrChunks);

    if (exitCode !== 0) {
      break;
    }
  }

  return {
    exitCode,
    stdout: Buffer.concat(stdoutChunks).toString("utf8"),
    stderr: Buffer.concat(stderrChunks).toString("utf8")
  };
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

async function runWorkspaceScript({ root, wsPath, scriptPhases, junitDestPath, activeChildren }) {
  const start = Date.now();
  const captured = await captureWorkspaceOutput({ root, wsPath, scriptPhases, junitDestPath, activeChildren });

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

// A worker leaves its slot in `results` undefined when it never got to start
// (--ff stopped scheduling first); that's the signal to bucket it as skipped.
function partitionResults(results, workspacesToRun) {
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

async function runWorkspaces({ root, workspacesToRun, scriptName, scriptCommands, ff, junitDir, concurrency, quiet }) {
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
      if (!quiet) {
        process.stdout.write(dim(`running ${name}\n`));
      }

      const junitDestPath = junitDir ? path.join(junitDir, `${index}.xml`) : undefined;

      let result;
      try {
        result = await runWorkspaceScript({ root, wsPath, scriptPhases: scriptCommands.get(wsPath), junitDestPath, activeChildren });
      }
      catch (error) {
        stopScheduling = true;
        killActiveChildren(activeChildren);
        throw new WorkspaceLaunchError(wsPath, scriptName, error);
      }
      results[index] = result;
      if (!quiet) {
        printWorkspaceResult(name, result, ciGroup);
      }

      if (result.exitCode !== 0 && ff) {
        stopScheduling = true;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, workspacesToRun.length));
  await withInterruptHandling(activeChildren, () => Promise.all(Array.from({ length: workerCount }, worker)));

  return partitionResults(results, workspacesToRun);
}

// Resolves which ref to diff against: the explicit --ref, or an auto-detected
// one (logged so the choice is never silent).
function resolveRefToUse(root, explicitRef, quiet) {
  if (explicitRef) {
    return { ref: explicitRef, label: explicitRef };
  }

  const resolved = resolveDefaultRef(root);
  log(quiet, dim(`--changed: no --ref given, comparing against "${resolved.label}" (${resolved.reason})`));
  return resolved;
}

// Returns the filtered workspace list to run, or null when nothing should run
// (already reported to the user), so main() can return early.
function applyChangedFilter(root, resolvedWorkspaces, workspacesToRun, explicitRef, quiet) {
  const { ref, label } = resolveRefToUse(root, explicitRef, quiet);

  const changedFiles = getChangedFiles(root, ref);
  if (changedFiles.length === 0) {
    log(quiet, dim(`No changes detected against "${label}".`));
    return null;
  }

  const { workspaces: changedWorkspaces, rootChangeFiles } = selectChangedWorkspaces(resolvedWorkspaces, changedFiles);

  if (rootChangeFiles.length > 0) {
    const suffix = rootChangeFiles.length > 1 ? ` (+${rootChangeFiles.length - 1} more)` : "";
    log(quiet, dim(`--changed: "${rootChangeFiles[0]}"${suffix} is outside every workspace, ignoring`));
  }

  const filtered = workspacesToRun.filter((wsPath) => changedWorkspaces.has(wsPath));
  log(quiet, dim(`--changed: running ${filtered.length}/${workspacesToRun.length} workspace(s) with changes since "${label}"`));

  if (filtered.length === 0) {
    log(quiet, dim("No eligible workspace changed."));
    return null;
  }

  return filtered;
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

async function runOnce({ root, workspacesToRun, scriptName, scriptCommands, ff, junitPath, concurrency, quiet }) {
  const junitDir = junitPath ? await mkdtemp(path.join(tmpdir(), "sumlyzer-junit-")) : null;

  let completed, skipped;
  try {
    ({ completed, skipped } = await runWorkspaces({ root, workspacesToRun, scriptName, scriptCommands, ff, junitDir, concurrency, quiet }));

    if (junitDir) {
      await writeJunitReport(root, junitPath, completed);
    }
  }
  finally {
    if (junitDir) {
      await rm(junitDir, { recursive: true, force: true });
    }
  }

  if (!quiet) {
    printSummary(completed, skipped);
    reportOutcome(completed);
  }

  return { completed, skipped };
}

// A workspace's own test run can write files inside itself (e.g. coverage, though that's
// already ignored) shortly after it exits. Without this, those trailing writes get picked
// up as a fresh change and the workspace re-runs itself indefinitely.
const SETTLE_COOLDOWN_MS = 500;

async function handleWatchChange({ changedPaths, dependentsGraph, settling, workspacesToRun, root, scriptName, scriptCommands, ff, concurrency }) {
  const affected = [...expandWithDependents(changedPaths, dependentsGraph)]
    .filter((wsPath) => workspacesToRun.includes(wsPath));

  if (affected.length === 0) {
    return;
  }

  const changedNames = [...changedPaths].map(workspaceName).join(", ");
  const affectedNames = affected.map(workspaceName).join(", ");
  console.log(dim(`\n[watch] change detected in ${changedNames} → re-running: ${affectedNames}\n`));

  for (const wsPath of affected) {
    settling.add(wsPath);
  }
  try {
    await runOnce({ root, workspacesToRun: affected, scriptName, scriptCommands, ff, junitPath: undefined, concurrency });
  }
  finally {
    setTimeout(() => {
      for (const wsPath of affected) {
        settling.delete(wsPath);
      }
    }, SETTLE_COOLDOWN_MS).unref();
  }
}

function runWatchMode({ root, workspaces, workspacesToRun, scriptName, scriptCommands, ff, concurrency }) {
  const dependentsGraph = buildDependentsGraph(root, workspaces);
  const settling = new Set();

  const watcher = watchWorkspaces({
    root,
    workspaces,
    isSuppressed: (wsPath) => settling.has(wsPath),
    onChange: (changedPaths) => handleWatchChange({ changedPaths, dependentsGraph, settling, workspacesToRun, root, scriptName, scriptCommands, ff, concurrency })
  });

  return new Promise((resolve) => {
    const stop = () => {
      console.log(dim("\n[watch] stopping.\n"));
      watcher.close();
      resolve();
    };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  });
}

export async function main({ root, scriptName, ff, junitPath, concurrency = 1, changed = false, ref, watch = false, quiet = false }) {

  const { workspaces } = readJson(path.join(root, "package.json"));

  if (!workspaces || workspaces.length === 0) {
    throw new NoWorkspacesError();
  }

  const resolvedWorkspaces = await resolveWorkspacePaths(root, workspaces);

  const { eligible: workspacesToRun, ownReporterConflicts, invalidPackageJson, scriptCommands } = listEligibleWorkspaces(root, resolvedWorkspaces, scriptName);

  if (invalidPackageJson.length > 0) {
    throw new InvalidPackageJsonError(invalidPackageJson);
  }

  for (const wsPath of ownReporterConflicts) {
    log(quiet, dim(`⊘ ${workspaceName(wsPath)}: skipped, own --test-reporter detected in its "${scriptName}" script`));
  }

  if (workspacesToRun.length === 0) {
    log(quiet, dim(ownReporterConflicts.length > 0
      ? `All workspaces with a "${scriptName}" script were skipped (own --test-reporter detected).`
      : `No workspace has a "${scriptName}" script.`));
    return { completed: [], skipped: [] };
  }

  let finalWorkspacesToRun = workspacesToRun;
  if (changed) {
    finalWorkspacesToRun = applyChangedFilter(root, resolvedWorkspaces, workspacesToRun, ref, quiet);
    if (finalWorkspacesToRun === null) {
      if (junitPath) {
        log(quiet, dim(`--junit: no report written to "${junitPath}" (no workspace ran)`));
      }
      return { completed: [], skipped: [] };
    }
  }

  const result = await runOnce({ root, workspacesToRun: finalWorkspacesToRun, scriptName, scriptCommands, ff, junitPath, concurrency, quiet });

  if (watch) {
    await runWatchMode({ root, workspaces: resolvedWorkspaces, workspacesToRun: finalWorkspacesToRun, scriptName, scriptCommands, ff, concurrency });
  }

  return result;
}
