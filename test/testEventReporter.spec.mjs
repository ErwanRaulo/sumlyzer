import { describe, it } from "node:test";
import assert from "node:assert/strict";

import testEventReporter, { parseReporterEvents, renderFailureRecap, renderSummaryText } from "../src/testEventReporter.mjs";

function jsonLine(obj) {
  return `${JSON.stringify(obj)}\n`;
}

async function* fakeSource(events) {
  for (const event of events) {
    yield event;
  }
}

async function collectLines(events) {
  const lines = [];
  for await (const line of testEventReporter(fakeSource(events))) {
    lines.push(JSON.parse(line));
  }
  return lines;
}

describe("testEventReporter (the node:test custom reporter itself)", () => {
  it("turns a test:fail event into a JSON line, picking the error's message/stack explicitly", async () => {
    const error = new Error("expected 2 to equal 3");
    const lines = await collectLines([
      { type: "test:fail", data: { name: "some assertion", details: { duration_ms: 4.2, error } } }
    ]);

    assert.deepEqual(lines, [{
      type: "test:fail",
      name: "some assertion",
      durationMs: 4.2,
      error: { message: "expected 2 to equal 3", stack: error.stack }
    }]);
  });

  it("prefers the cause's stack (with file:line) over the wrapper error's own frameless stack", async () => {
    const cause = new Error("2 !== 3");
    const wrapper = new Error("Expected values to be strictly equal");
    wrapper.stack = "Error [ERR_TEST_FAILURE]: Expected values to be strictly equal";
    wrapper.cause = cause;

    const lines = await collectLines([
      { type: "test:fail", data: { name: "some assertion", details: { duration_ms: 4.2, error: wrapper } } }
    ]);

    assert.equal(lines[0].error.stack, cause.stack);
  });

  it("falls back to String(error) when the failure's error has no message", async () => {
    const lines = await collectLines([
      { type: "test:fail", data: { name: "weird failure", details: { duration_ms: 0, error: "not an Error instance" } } }
    ]);

    assert.equal(lines[0].error.message, "not an Error instance");
    assert.equal(lines[0].error.stack, null);
  });

  it("reports no error when the failure event carries none", async () => {
    const lines = await collectLines([
      { type: "test:fail", data: { name: "no error attached", details: {} } }
    ]);

    assert.equal(lines[0].error, null);
    assert.equal(lines[0].durationMs, 0);
  });

  it("only emits the aggregate test:summary (the one without a file), skipping per-file summaries", async () => {
    const lines = await collectLines([
      { type: "test:summary", data: { file: "/repo/test/a.spec.mjs", counts: { tests: 1, passed: 1, failed: 0, skipped: 0, todo: 0, cancelled: 0 }, duration_ms: 1 } },
      { type: "test:summary", data: { file: undefined, counts: { tests: 4, passed: 2, failed: 2, skipped: 0, todo: 0, cancelled: 0 }, duration_ms: 88 } }
    ]);

    assert.deepEqual(lines, [{
      type: "test:summary",
      counts: { tests: 4, pass: 2, fail: 2, skip: 0, todo: 0, cancelled: 0 },
      durationMs: 88
    }]);
  });

  it("ignores event types we don't care about", async () => {
    const lines = await collectLines([
      { type: "test:pass", data: { name: "irrelevant" } },
      { type: "test:start", data: {} },
      { type: "test:diagnostic", data: {} }
    ]);

    assert.deepEqual(lines, []);
  });
});

describe("parseReporterEvents", () => {
  it("extracts counts and failing tests from our own JSON event lines", () => {
    const output =
      jsonLine({ type: "test:fail", name: "some assertion", durationMs: 4.2, error: { message: "boom", stack: "Error: boom" } }) +
      jsonLine({ type: "test:fail", name: "another assertion", durationMs: 1.1, error: { message: "bang", stack: "Error: bang" } }) +
      jsonLine({ type: "test:summary", counts: { tests: 4, pass: 2, fail: 2, skip: 0, todo: 0, cancelled: 0 }, durationMs: 88 });

    const { counts, failingTests, failures } = parseReporterEvents(output);

    assert.deepEqual(counts, { tests: 4, pass: 2, fail: 2, skip: 0, todo: 0, cancelled: 0, durationMs: 88 });
    assert.deepEqual(failingTests, ["some assertion", "another assertion"]);
    assert.equal(failures.length, 2);
  });

  it("returns null counts when no summary event is present (workspace didn't run node:test)", () => {
    const { counts, failingTests, failures } = parseReporterEvents("custom reporter output, no parseable counts here\n");

    assert.equal(counts, null);
    assert.deepEqual(failingTests, []);
    assert.deepEqual(failures, []);
  });

  it("ignores npm noise and other non-JSON lines interleaved with our events", () => {
    const output =
      'npm warn Unknown env config "allow-git".\n' +
      "> pkg@1.0.0 test\n" +
      jsonLine({ type: "test:summary", counts: { tests: 1, pass: 1, fail: 0, skip: 0, todo: 0, cancelled: 0 }, durationMs: 5 });

    const { counts } = parseReporterEvents(output);

    assert.deepEqual(counts, { tests: 1, pass: 1, fail: 0, skip: 0, todo: 0, cancelled: 0, durationMs: 5 });
  });
});

describe("renderFailureRecap", () => {
  it("formats each failing test with its duration and error detail", () => {
    const recap = renderFailureRecap([
      { name: "some assertion", durationMs: 12.34, error: { message: "expected 2 to equal 3", stack: "Error: expected 2 to equal 3\n    at foo" } }
    ]);

    assert.match(recap, /^✖ some assertion \(12\.3ms\)$/m);
    assert.match(recap, /expected 2 to equal 3/);
  });

  it("still prints a header when there is no error detail", () => {
    const recap = renderFailureRecap([{ name: "mystery failure", durationMs: 0, error: null }]);

    assert.equal(recap, "✖ mystery failure (0.0ms)");
  });
});

describe("renderSummaryText", () => {
  it("renders the node:test-style trailer from structured counts", () => {
    const text = renderSummaryText({ tests: 3, pass: 3, fail: 0, skip: 0, todo: 0, cancelled: 0, durationMs: 42 });

    assert.match(text, /ℹ tests 3/);
    assert.match(text, /ℹ pass 3/);
    assert.match(text, /ℹ duration_ms 42/);
  });
});
