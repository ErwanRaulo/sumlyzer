import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { envWithTestReporter, hasOwnTestReporter } from "../src/run.mjs";

const REPORTER_PATH = fileURLToPath(new URL("../src/testEventReporter.mjs", import.meta.url));
const TEST_REPORTER_FLAGS = `--test-reporter=${REPORTER_PATH} --test-reporter-destination=stdout`;

describe("envWithTestReporter", () => {
  it("forces sumlyzer's own test reporter regardless of the child's TTY detection", () => {
    const env = envWithTestReporter({ PATH: "/usr/bin" });

    assert.equal(env.PATH, "/usr/bin");
    assert.equal(env.NODE_OPTIONS, TEST_REPORTER_FLAGS);
  });

  it("appends to an existing NODE_OPTIONS instead of overwriting it", () => {
    const env = envWithTestReporter({ NODE_OPTIONS: "--max-old-space-size=4096" });

    assert.equal(env.NODE_OPTIONS, `--max-old-space-size=4096 ${TEST_REPORTER_FLAGS}`);
  });

  it("also registers a junit reporter when a destination path is given", () => {
    const env = envWithTestReporter({}, "/tmp/report.xml");

    assert.equal(
      env.NODE_OPTIONS,
      `${TEST_REPORTER_FLAGS} --test-reporter=junit --test-reporter-destination=/tmp/report.xml`
    );
  });

  it("strips NODE_TEST_CONTEXT so a nested node:test workspace never sees itself as a child run", () => {
    const env = envWithTestReporter({ PATH: "/usr/bin", NODE_TEST_CONTEXT: "child-v8" });

    assert.equal(env.NODE_TEST_CONTEXT, undefined);
    assert.equal(env.PATH, "/usr/bin");
  });
});

describe("hasOwnTestReporter", () => {
  it("flags a workspace script that configures its own --test-reporter", () => {
    assert.equal(hasOwnTestReporter('node --test --test-reporter=spec --test-reporter-destination=stdout "./test/*.spec.mjs"'), true);
    assert.equal(hasOwnTestReporter("node --test --test-reporter tap"), true);
  });

  it("does not flag --test-reporter-destination on its own (no --test-reporter alongside it)", () => {
    assert.equal(hasOwnTestReporter("node --test --test-reporter-destination=stdout"), false);
  });

  it("does not flag a plain node --test invocation", () => {
    assert.equal(hasOwnTestReporter('node --test "./test/*.spec.mjs"'), false);
  });
});
