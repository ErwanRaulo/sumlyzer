import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { availableParallelism } from "node:os";

import { assertWellFormedXml } from "./xmlAssertions.mjs";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "sumlyzer.mjs");

const TEST_PATH = path.join(ROOT, "test");
const PROJECT_WITH_WORKSPACES = path.join(TEST_PATH, "workspaces-fixture");
const PROJECT_WITHOUT_WORKSPACES = path.join(TEST_PATH, "no-workspaces-fixture");
const RUN_FIXTURE = path.join(TEST_PATH, "run-fixture");
const NO_ELIGIBLE_FIXTURE = path.join(TEST_PATH, "no-eligible-fixture");
const EMPTY_WORKSPACES_FIXTURE = path.join(TEST_PATH, "empty-workspaces-fixture");
const JUNIT_FIXTURE = path.join(TEST_PATH, "junit-fixture");
const OWN_REPORTER_FIXTURE = path.join(TEST_PATH, "own-reporter-fixture");
const ALL_OWN_REPORTER_FIXTURE = path.join(TEST_PATH, "all-own-reporter-fixture");
const INVALID_JSON_FIXTURE = path.join(TEST_PATH, "invalid-json-fixture");
const GLOB_WORKSPACES_FIXTURE = path.join(TEST_PATH, "glob-workspaces-fixture");
const INTERRUPT_FIXTURE = path.join(TEST_PATH, "interrupt-fixture");
const INTERRUPT_MARKER = "sumlyzer-interrupt-fixture-marker";

async function pgrepMatches(pattern) {
  try {
    const { stdout } = await execFileAsync("pgrep", ["-f", pattern]);
    return stdout.trim().length > 0;
  }
  catch {
    // pgrep exits 1 (no stdout) when nothing matches.
    return false;
  }
}

// A PATH containing only a "node" symlink: enough to launch the CLI itself,
// but any spawn("npm", ...) it does will fail to resolve and error out.
async function pathWithoutNpm() {
  const dir = await mkdtemp(path.join(tmpdir(), "sumlyzer-no-npm-"));
  await symlink(process.execPath, path.join(dir, "node"));
  return dir;
}

async function waitUntil(predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitUntil: condition was never met within the timeout");
}

async function runCli(args, cwd, env) {
  // Avoid suite's own CI run setting GITHUB_ACTIONS=true, which would trigger the fold markers.
  // Also strip FORCE_COLOR: a shell that forces colors on would inject ANSI codes into stdout
  // and break assertions that expect plain adjacent text.
  const childEnv = { ...process.env };
  delete childEnv.GITHUB_ACTIONS;
  delete childEnv.FORCE_COLOR;
  Object.assign(childEnv, env);

  try {
    const { stdout, stderr } = await execFileAsync("node", [BIN, ...args], { cwd, env: childEnv });
    return { stdout, stderr, code: 0 };
  }
  catch (error) {
    return { stdout: error.stdout, stderr: error.stderr, code: error.code };
  }
}

describe("sumlyzer CLI behaviors", () => {
  it("--help prints usage and exits 0", async () => {
    const { stdout } = await execFileAsync("node", [BIN, "--help"], { cwd: PROJECT_WITH_WORKSPACES });

    assert.match(stdout, /sumlyzer \[options\]/);
    assert.match(stdout, /--script <name>/);
    assert.match(stdout, /--ff/);
    assert.match(stdout, /--junit <path>/);
    assert.match(stdout, /-c, --concurrency <n>/);
    assert.match(stdout, /-h, --help/);
  });

  it("-h is the same as --help", async () => {
    const [full, short] = await Promise.all([
      execFileAsync("node", [BIN, "--help"], { cwd: PROJECT_WITH_WORKSPACES }),
      execFileAsync("node", [BIN, "-h"], { cwd: PROJECT_WITH_WORKSPACES })
    ]);

    assert.equal(short.stdout, full.stdout);
  });

  it("-c is the same as --concurrency", async () => {
    const [long, short] = await Promise.all([
      execFileAsync("node", [BIN, "--help", "--concurrency", "4"], { cwd: PROJECT_WITH_WORKSPACES }),
      execFileAsync("node", [BIN, "--help", "-c", "4"], { cwd: PROJECT_WITH_WORKSPACES })
    ]);

    assert.equal(short.stdout, long.stdout);
    assert.match(long.stdout, /4 at a time/);
  });

  it("--concurrency above availableParallelism() is clamped down", async () => {
    const max = availableParallelism();
    const { stdout } = await execFileAsync("node", [BIN, "--help", "--concurrency", String(max + 100)], { cwd: PROJECT_WITH_WORKSPACES });

    assert.match(stdout, new RegExp(`exceeds the available parallelism \\(${max}\\), clamping to ${max}\\.`));
    assert.match(stdout, new RegExp(`${max} at a time`));
  });

  it("reflects --script in the help text instead of the \"test\" default", async () => {
    const { stdout } = await execFileAsync("node", [BIN, "--help", "--script", "check"], { cwd: PROJECT_WITH_WORKSPACES });

    assert.match(stdout, /"check" script/);
  });

  it("prints a friendly message for an unknown flag instead of a stack trace", async () => {
    await assert.rejects(
      execFileAsync("node", [BIN, "--unknown-flag"], { cwd: PROJECT_WITH_WORKSPACES }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /Unknown option '--unknown-flag'/);
        assert.match(error.stdout, /sumlyzer --help/);
        assert.doesNotMatch(error.stdout, /at ModuleJob|node:internal/);
        return true;
      }
    );
  });

  it("prints a friendly message if project does not have any workspaces", async () => {
    await assert.rejects(
      execFileAsync("node", [BIN], { cwd: PROJECT_WITHOUT_WORKSPACES }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /Your project does not have any workspaces./);
        assert.doesNotMatch(error.stdout, /Summary /);
        return true;
      }
    );

  });

  it("treats an explicit empty workspaces array the same as a missing one", async () => {
    await assert.rejects(
      execFileAsync("node", [BIN], { cwd: EMPTY_WORKSPACES_FIXTURE }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /Your project does not have any workspaces./);
        assert.doesNotMatch(error.stdout, /Summary/);
        return true;
      }
    );
  });

  it("prints a friendly message instead of a stack trace for a stray positional argument", async () => {
    await assert.rejects(
      execFileAsync("node", [BIN, "foo"], { cwd: PROJECT_WITH_WORKSPACES }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /does not take positional arguments/);
        assert.match(error.stdout, /sumlyzer --help/);
        assert.doesNotMatch(error.stdout, /at ModuleJob|node:internal/);
        return true;
      }
    );
  });

  it("prints a friendly message instead of a stack trace when --script is missing its value", async () => {
    await assert.rejects(
      execFileAsync("node", [BIN, "--script"], { cwd: PROJECT_WITH_WORKSPACES }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /argument missing/);
        assert.match(error.stdout, /sumlyzer --help/);
        assert.doesNotMatch(error.stdout, /at ModuleJob|node:internal/);
        return true;
      }
    );
  });

  for (const invalid of ["0", "1.5", "abc"]) {
    it(`prints a friendly message instead of a stack trace for --concurrency ${invalid}`, async () => {
      await assert.rejects(
        execFileAsync("node", [BIN, "--concurrency", invalid], { cwd: PROJECT_WITH_WORKSPACES }),
        (error) => {
          assert.equal(error.code, 1);
          assert.match(error.stdout, /--concurrency must be a positive integer/);
          assert.match(error.stdout, /sumlyzer --help/);
          assert.doesNotMatch(error.stdout, /at ModuleJob|node:internal/);
          return true;
        }
      );
    });
  }

  it("prints a friendly message instead of a stack trace for --concurrency=-1", async () => {
    await assert.rejects(
      execFileAsync("node", [BIN, "--concurrency=-1"], { cwd: PROJECT_WITH_WORKSPACES }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stdout, /--concurrency must be a positive integer/);
        assert.match(error.stdout, /sumlyzer --help/);
        assert.doesNotMatch(error.stdout, /at ModuleJob|node:internal/);
        return true;
      }
    );
  });
});

describe("sumlyzer run behavior", () => {
  it("runs every eligible workspace, reports pass/fail per workspace and an overall summary", async () => {
    const { stdout, code } = await runCli([], RUN_FIXTURE);

    assert.equal(code, 1);

    // custom-script-ws has no "test" script: it never runs and is never mentioned.
    assert.doesNotMatch(stdout, /custom-script-ws/);

    assert.match(stdout, /running fail-ws/);
    assert.match(stdout, /✗ fail-ws failed/);
    assert.match(stdout, /✖ some assertion/);
    assert.match(stdout, /✖ another assertion/);

    assert.match(stdout, /✓ pass-ws/);
    assert.match(stdout, /✓ custom-runner-ws/);

    // no --ff: all three eligible workspaces ran, none skipped.
    assert.doesNotMatch(stdout, /SKIPPED/);
    assert.match(stdout, /1\/3 workspace\(s\) failed:/);
  });

  it("resolves \"workspaces\" glob patterns to their actual matching directories, honoring \"!\" exclusions", async () => {
    const { stdout, code } = await runCli([], GLOB_WORKSPACES_FIXTURE);

    assert.equal(code, 0);
    assert.match(stdout, /running pass-a/);
    assert.match(stdout, /running pass-b/);
    assert.match(stdout, /✓ pass-a/);
    assert.match(stdout, /✓ pass-b/);

    // "!workspaces/excluded-ws" must exclude it from the "workspaces/*" match entirely.
    assert.doesNotMatch(stdout, /excluded-ws/);
    assert.match(stdout, /2\/2 workspaces passed/);
  });

  it("--ff stops at the first failing workspace and marks the rest as skipped", async () => {
    const { stdout, code } = await runCli(["--ff"], RUN_FIXTURE);

    assert.equal(code, 1);
    assert.match(stdout, /running fail-ws/);
    assert.doesNotMatch(stdout, /running pass-ws/);
    assert.doesNotMatch(stdout, /running custom-runner-ws/);
    assert.match(stdout, /2 workspace\(s\) skipped \(--ff\): pass-ws, custom-runner-ws/);
    assert.match(stdout, /1\/1 workspace\(s\) failed:/);

    // regression guard: a workspace that never ran must not also be listed as PASS.
    assert.doesNotMatch(stdout, /pass-ws\W+PASS/);
  });

  it("--concurrency runs every eligible workspace regardless of completion order", async () => {
    const { stdout, code } = await runCli(["--concurrency", "3"], RUN_FIXTURE);

    assert.equal(code, 1);

    assert.match(stdout, /running fail-ws/);
    assert.match(stdout, /running pass-ws/);
    assert.match(stdout, /running custom-runner-ws/);

    assert.match(stdout, /✗ fail-ws failed/);
    assert.match(stdout, /✖ some assertion/);
    assert.match(stdout, /✖ another assertion/);
    assert.match(stdout, /✓ pass-ws/);
    assert.match(stdout, /✓ custom-runner-ws/);

    assert.doesNotMatch(stdout, /SKIPPED/);
    assert.match(stdout, /1\/3 workspace\(s\) failed:/);
  });

  it("--ff with --concurrency only skips workspaces that never started", async () => {
    const { stdout, code } = await runCli(["--ff", "--concurrency", "2"], RUN_FIXTURE);

    assert.equal(code, 1);

    assert.match(stdout, /running fail-ws/);
    assert.match(stdout, /✗ fail-ws failed/);
    assert.match(stdout, /1\/\d workspace\(s\) failed:\n {2}fail-ws/);

    const ranMatch = stdout.match(/\d+\/(\d+) workspace\(s\) failed:/);
    const skippedMatch = stdout.match(/(\d+) workspace\(s\) skipped \(--ff\)/);
    const ranCount = Number(ranMatch[1]);
    const skippedCount = skippedMatch ? Number(skippedMatch[1]) : 0;

    assert.equal(ranCount + skippedCount, 3);
  });

  it("on GitHub Actions, folds each workspace's full output behind group/endgroup instead of the plain format", async () => {
    const { stdout, code } = await runCli([], RUN_FIXTURE, { GITHUB_ACTIONS: "true" });

    assert.equal(code, 1);

    assert.match(stdout, /::group::✓ pass-ws.*\(3\/3 tests\)/);
    assert.match(stdout, /ℹ tests 3/); 
    assert.match(stdout, /::group::✗ fail-ws.*\(2\/4 tests\)/);
    assert.match(stdout, /✖ some assertion \(\d+(\.\d+)?ms\)/);
    assert.match(stdout, /::endgroup::/);

    // the plain-format markers must NOT appear.
    assert.doesNotMatch(stdout, /✗ fail-ws failed/);
  });

  it("--script switches which npm script is run and re-applies eligibility filtering", async () => {
    const { stdout, code } = await runCli(["--script", "verify"], RUN_FIXTURE);

    assert.equal(code, 0);
    assert.match(stdout, /running custom-script-ws/);
    assert.match(stdout, /✓ custom-script-ws/);

    // workspaces without a "verify" script are excluded entirely.
    assert.doesNotMatch(stdout, /fail-ws/);
    assert.doesNotMatch(stdout, /pass-ws/);
    assert.doesNotMatch(stdout, /custom-runner-ws/);
    assert.match(stdout, /1\/1 workspaces passed\./);
  });

  it("--junit warns when a workspace's script never produced a junit file (e.g. --script isn't node:test)", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "sumlyzer-junit-cli-"));
    const outFile = path.join(outDir, "report.xml");

    try {
      const { stdout, code } = await runCli(["--script", "verify", "--junit", outFile], RUN_FIXTURE);

      assert.equal(code, 0);
      assert.match(stdout, /1 workspace\(s\) missing from the JUnit report: custom-script-ws/);

      const report = await readFile(outFile, "utf8");
      assertWellFormedXml(report);
    }
    finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("prints a clear message and exits 0 when no workspace has the target script, instead of crashing", async () => {
    const { stdout, code } = await runCli([], NO_ELIGIBLE_FIXTURE);

    assert.equal(code, 0);
    assert.match(stdout, /No workspace has a "test" script\./);
    assert.doesNotMatch(stdout, /Your project does not have any workspaces\./);
    assert.doesNotMatch(stdout, /workspaces passed/);
  });

  it("reports every workspace with invalid JSON in its package.json and exits before running anything", async () => {
    const { stdout, stderr, code } = await runCli([], INVALID_JSON_FIXTURE);

    assert.equal(code, 1);
    assert.match(stderr, /✗ broken-ws: could not read its package\.json/);
    assert.match(stderr, /✗ broken-ws-2: could not read its package\.json/);
    // npm resolves every workspace up front, so nothing can run until the JSON is fixed.
    assert.doesNotMatch(stdout, /running pass-ws/);
    assert.doesNotMatch(stdout, /workspaces passed/);
  });

  it("stops scheduling and reports the workspace when npm itself can't be launched", async () => {
    const noNpmPath = await pathWithoutNpm();

    try {
      const { stdout, stderr, code } = await runCli(["--concurrency", "1"], RUN_FIXTURE, { PATH: noNpmPath });

      assert.equal(code, 1);
      assert.match(stderr, /✗ fail-ws: could not launch "test" \(spawn npm ENOENT\)/);

      // the launch error aborts the whole run: only the first eligible workspace
      // is even attempted, nothing after it gets scheduled.
      assert.match(stdout, /running fail-ws/);
      assert.doesNotMatch(stdout, /running pass-ws/);
      assert.doesNotMatch(stdout, /running custom-runner-ws/);
      assert.doesNotMatch(stdout, /workspace\(s\) failed/);
    }
    finally {
      await rm(noNpmPath, { recursive: true, force: true });
    }
  });

  it("kills the underlying test process on SIGINT instead of leaving it orphaned", async () => {
    const child = spawn("node", [BIN], { cwd: INTERRUPT_FIXTURE });
    let stdout = "";

    await new Promise((resolve, reject) => {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (stdout.includes("running slow-ws")) {
          resolve();
        }
      });
      child.on("error", reject);
    });

    // "running slow-ws" is printed before the actual npm/node process chain is spawned,
    // so poll until the grandchild is genuinely alive instead of racing it.
    await waitUntil(() => pgrepMatches(INTERRUPT_MARKER));

    const exitPromise = new Promise((resolve) => child.on("exit", (code) => resolve(code)));
    child.kill("SIGINT");
    const code = await exitPromise;

    assert.equal(code, 130);

    await waitUntil(async () => !(await pgrepMatches(INTERRUPT_MARKER)));
  });

  it("skips a workspace whose own script sets --test-reporter, instead of colliding with sumlyzer's", async () => {
    const { stdout, code } = await runCli([], OWN_REPORTER_FIXTURE);

    assert.equal(code, 0);
    assert.match(stdout, /⊘ own-reporter-ws: skipped, own --test-reporter detected in its "test" script/);
    assert.doesNotMatch(stdout, /running own-reporter-ws/);
    assert.match(stdout, /1\/1 workspaces passed\./);
  });

  it("prints a dedicated message when every workspace with the target script was skipped for its own reporter", async () => {
    const { stdout, code } = await runCli([], ALL_OWN_REPORTER_FIXTURE);

    assert.equal(code, 0);
    assert.match(stdout, /⊘ own-reporter-ws: skipped, own --test-reporter detected in its "test" script/);
    assert.match(stdout, /All workspaces with a "test" script were skipped \(own --test-reporter detected\)\./);
    assert.doesNotMatch(stdout, /No workspace has a "test" script\./);
    assert.doesNotMatch(stdout, /workspaces passed/);
  });

  it("--junit writes an aggregated JUnit report merging every workspace's testsuites", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "sumlyzer-junit-cli-"));
    const outFile = path.join(outDir, "report.xml");

    try {
      const { code } = await runCli(["--junit", outFile], JUNIT_FIXTURE);

      assert.equal(code, 1);

      const report = await readFile(outFile, "utf8");
      assert.match(report, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
      assert.match(report, /<testsuites>[\s\S]*<\/testsuites>/);
      assert.match(report, /<testsuite name="pass-ws">[\s\S]*<testcase name="adds numbers"/);
      assert.match(report, /<testsuite name="fail-ws">[\s\S]*<testcase name="breaks"/);
      assert.match(report, /<failure/);
      assertWellFormedXml(report);
    }
    finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("--junit keeps nested describe() blocks as nested <testsuite> elements without unbalancing the merged XML", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "sumlyzer-junit-cli-"));
    const outFile = path.join(outDir, "report.xml");

    try {
      await runCli(["--junit", outFile], JUNIT_FIXTURE);

      const report = await readFile(outFile, "utf8");
      assert.match(report, /<testsuite name="nested-ws › outer suite"[^>]*>[\s\S]*<testsuite name="inner suite"[^>]*>/);
      assertWellFormedXml(report);
    }
    finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("--junit writes to <dir>/junit.xml when <path> is an existing directory", async () => {
    const outDir = await mkdtemp(path.join(tmpdir(), "sumlyzer-junit-cli-"));

    try {
      const { code } = await runCli(["--junit", outDir], JUNIT_FIXTURE);

      assert.equal(code, 1);

      const report = await readFile(path.join(outDir, "junit.xml"), "utf8");
      assert.match(report, /<testsuite name="pass-ws">/);
    }
    finally {
      await rm(outDir, { recursive: true, force: true });
    }
  });

  it("prints a friendly message instead of a stack trace when the JUnit report can't be written", async () => {
    const { stderr, code } = await runCli(["--junit", "/no-such-directory/report.xml"], JUNIT_FIXTURE);

    assert.equal(code, 1);
    assert.match(stderr, /Could not write JUnit report to "\/no-such-directory\/report.xml"/);
    assert.doesNotMatch(stderr, /at async|node:internal/);
  });
});

