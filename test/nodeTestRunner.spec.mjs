import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { hasOwnReporter, prepareEnv } from "../src/runners/nodeTest.mjs";
import { withTempDir } from "./gitTestHelpers.mjs";

const execFileAsync = promisify(execFile);

// A file:// URL, not a path: on Windows the ESM loader rejects "D:\\..." as an
// unsupported URL scheme.
const REPORTER_URL = new URL("../src/testEventReporter.mjs", import.meta.url).href;
const TEST_REPORTER_FLAGS = `--test-reporter="${REPORTER_URL}" --test-reporter-destination=stdout`;

describe("prepareEnv", () => {
  it("forces sumlyzer's own test reporter regardless of the child's TTY detection", () => {
    const env = prepareEnv({ PATH: "/usr/bin" });

    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.NODE_OPTIONS, TEST_REPORTER_FLAGS);
  });

  it("appends to an existing NODE_OPTIONS instead of overwriting it", () => {
    const env = prepareEnv({ NODE_OPTIONS: "--max-old-space-size=4096" });

    assert.equal(env.NODE_OPTIONS, `--max-old-space-size=4096 ${TEST_REPORTER_FLAGS}`);
  });

  it("also registers a junit reporter when a destination path is given", () => {
    const env = prepareEnv({}, "/tmp/report.xml");

    assert.equal(
      env.NODE_OPTIONS,
      `${TEST_REPORTER_FLAGS} --test-reporter=junit --test-reporter-destination="/tmp/report.xml"`
    );
  });

  it("quotes a junit destination path containing spaces so NODE_OPTIONS doesn't split it", () => {
    const env = prepareEnv({}, "/tmp/my project/report.xml");

    assert.equal(
      env.NODE_OPTIONS,
      `${TEST_REPORTER_FLAGS} --test-reporter=junit --test-reporter-destination="/tmp/my project/report.xml"`
    );
  });

  it("passes the reporter as a file:// URL so the ESM loader accepts it on Windows", () => {
    const env = prepareEnv({});

    assert.match(env.NODE_OPTIONS, /^--test-reporter="file:\/\/\//);
  });

  it("escapes backslashes and quotes in the junit path, which NODE_OPTIONS would otherwise swallow", () => {
    const env = prepareEnv({}, String.raw`C:\Temp\say "hi"\report.xml`);

    assert.ok(
      env.NODE_OPTIONS.endsWith(String.raw` --test-reporter-destination="C:\\Temp\\say \"hi\"\\report.xml"`),
      env.NODE_OPTIONS
    );
  });

  it("produces a NODE_OPTIONS that node parses back to the exact junit path, backslashes included", async () => {
    await withTempDir("sumlyzer-node-options-", async (dir) => {
      // A backslash is a valid file name character on POSIX, so this exercises the
      // same escaping a Windows path needs.
      const junitDir = path.join(dir, String.raw`out\with\backslashes`);
      await mkdir(junitDir);
      await writeFile(path.join(dir, "ok.spec.mjs"), "import { test } from 'node:test'; test('ok', () => {});");
      const junitPath = path.join(junitDir, "report.xml");

      const env = prepareEnv({ ...process.env }, junitPath);
      await execFileAsync(process.execPath, ["--test", "ok.spec.mjs"], { cwd: dir, env });

      await assert.doesNotReject(access(junitPath));
    });
  });

  it("strips NODE_TEST_CONTEXT so a nested node:test workspace never sees itself as a child run", () => {
    const env = prepareEnv({ PATH: "/usr/bin", NODE_TEST_CONTEXT: "child-v8" });

    assert.equal(env.NODE_TEST_CONTEXT, undefined);
    assert.equal(env.PATH, "/usr/bin");
  });
});

describe("hasOwnReporter", () => {
  it("flags a workspace script that configures its own --test-reporter", () => {
    assert.equal(hasOwnReporter('node --test --test-reporter=spec --test-reporter-destination=stdout "./test/*.spec.mjs"'), true);
    assert.equal(hasOwnReporter("node --test --test-reporter tap"), true);
  });

  it("does not flag --test-reporter-destination on its own (no --test-reporter alongside it)", () => {
    assert.equal(hasOwnReporter("node --test --test-reporter-destination=stdout"), false);
  });

  it("does not flag a plain node --test invocation", () => {
    assert.equal(hasOwnReporter('node --test "./test/*.spec.mjs"'), false);
  });
});
