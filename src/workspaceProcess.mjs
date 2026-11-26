import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

import { runner } from "./runner.mjs";
import { scriptEnv } from "./scriptEnv.mjs";

// The shell is the test runner's parent: kill the whole process group (POSIX)
// or tree (Windows), otherwise the runner outlives it.
function killTree(child) {
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

export function killAll(activeChildren) {
  for (const child of activeChildren) {
    killTree(child);
  }
}

export async function withInterruptHandling(activeChildren, run) {
  function onInterrupt(signal) {
    killAll(activeChildren);
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

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}

async function runPhase(command, options, activeChildren) {
  const child = spawn(command, options);
  activeChildren.add(child);
  const stdout = [];
  const stderr = [];

  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));

  try {
    return { exitCode: await waitForExit(child), stdout, stderr };
  }
  finally {
    activeChildren.delete(child);
  }
}

// Phases stop at the first failure, like npm run.
async function runPhases({ root, workspace, junitDestPath, activeChildren }) {
  const cwd = path.join(root, workspace.path);
  const stdout = [];
  const stderr = [];
  let exitCode = 0;

  for (const phase of workspace.phases) {
    const options = { cwd, shell: true, detached: process.platform !== "win32", env: scriptEnv({ root, workspace, phase, junitDestPath }) };
    const result = await runPhase(phase.command, options, activeChildren);
    exitCode = result.exitCode;
    stdout.push(...result.stdout);
    stderr.push(...result.stderr);

    if (exitCode !== 0) {
      break;
    }
  }

  return {
    exitCode,
    stdout: Buffer.concat(stdout).toString("utf8"),
    stderr: Buffer.concat(stderr).toString("utf8")
  };
}

export async function runWorkspace({ root, workspace, junitDestPath, activeChildren }) {
  const start = Date.now();
  const captured = await runPhases({ root, workspace, junitDestPath, activeChildren });

  return {
    wsPath: workspace.path,
    exitCode: captured.exitCode,
    durationMs: Date.now() - start,
    junitDestPath,
    ...runner.parseResult(captured)
  };
}
