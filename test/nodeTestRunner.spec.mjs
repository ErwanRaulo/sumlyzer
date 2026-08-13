import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { hasOwnReporter, prepareEnv } from "../src/runners/nodeTest.mjs";

const REPORTER_PATH = fileURLToPath(new URL("../src/testEventReporter.mjs", import.meta.url));
const TEST_REPORTER_FLAGS = `--test-reporter="${REPORTER_PATH}" --test-reporter-destination=stdout`;

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
