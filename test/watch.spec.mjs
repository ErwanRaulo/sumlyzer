import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, cp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "sumlyzer.mjs");
const FIXTURE = path.join(ROOT, "test", "watch-fixture");

function spawnWatch(cwd) {
  const env = { ...process.env };
  delete env.GITHUB_ACTIONS;
  delete env.FORCE_COLOR;

  const child = spawn("node", [BIN, "--watch"], { cwd, env });
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });

  return { child, getStdout: () => stdout };
}

function waitFor(predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    (function check() {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(check, 100);
    })();
  });
}

async function withWatchFixture(fn) {
  const cwd = await mkdtemp(path.join(tmpdir(), "sumlyzer-watch-"));
  await cp(FIXTURE, cwd, { recursive: true });
  const { child, getStdout } = spawnWatch(cwd);

  let exited = false;
  const exitPromise = new Promise((resolve) => {
    child.once("exit", (code, signal) => {
      exited = true;
      resolve([code, signal]);
    });
  });

  try {
    await fn({ cwd, child, getStdout, exitPromise });
  }
  finally {
    if (!exited) {
      child.kill("SIGINT");
      await exitPromise;
    }
    await rm(cwd, { recursive: true, force: true });
  }
}

describe("sumlyzer --watch", () => {
  it("re-runs a workspace and its dependents when the dependency changes", async () => {
    await withWatchFixture(async ({ cwd, getStdout }) => {
      await waitFor(() => /2\/2 workspaces passed\./.test(getStdout()));

      await writeFile(path.join(cwd, "workspaces/base/marker.txt"), "changed");

      await waitFor(() => /\[watch\] change detected in base .*re-running: base, dependent/.test(getStdout()));
      await waitFor(() => getStdout().split("2/2 workspaces passed.").length - 1 >= 2);
    });
  });

  it("does not loop when a workspace's own test run writes a file inside itself", async () => {
    await withWatchFixture(async ({ cwd, getStdout }) => {
      await waitFor(() => /2\/2 workspaces passed\./.test(getStdout()));

      await writeFile(path.join(cwd, "workspaces/base/marker.txt"), "changed");
      await waitFor(() => getStdout().split("2/2 workspaces passed.").length - 1 >= 2);

      // "base"'s own run.mjs writes self-output.txt on every run (simulating coverage-like
      // output); give a feedback loop time to happen before asserting it didn't.
      await new Promise((resolve) => setTimeout(resolve, 1500));

      const changeCount = getStdout().split("[watch] change detected").length - 1;
      assert.equal(changeCount, 1, `expected exactly one re-run, got ${changeCount}:\n${getStdout()}`);
    });
  });

  it("only re-runs the changed workspace when nothing depends on it", async () => {
    await withWatchFixture(async ({ cwd, getStdout }) => {
      await waitFor(() => /2\/2 workspaces passed\./.test(getStdout()));

      await writeFile(path.join(cwd, "workspaces/dependent/marker.txt"), "changed");

      await waitFor(() => /\[watch\] change detected in dependent /.test(getStdout()));
      await waitFor(() => getStdout().split("1/1 workspaces passed.").length - 1 >= 1);

      const watchLines = getStdout().match(/\[watch\][^\n]*/g) ?? [];
      assert.ok(watchLines.some((line) => /re-running: dependent$/.test(line)));
      assert.ok(watchLines.every((line) => !line.includes("re-running: base")));
    });
  });

  it("stops cleanly on SIGINT", async () => {
    await withWatchFixture(async ({ child, getStdout, exitPromise }) => {
      await waitFor(() => /2\/2 workspaces passed\./.test(getStdout()));

      child.kill("SIGINT");
      const [code] = await exitPromise;

      assert.equal(code, 0);
      assert.match(getStdout(), /\[watch\] stopping\./);
    });
  });
});
