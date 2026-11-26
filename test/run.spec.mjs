import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { main } from "../src/run.mjs";

const RUN_FIXTURE = fileURLToPath(new URL("run-fixture", import.meta.url));

function recordingReporter() {
  const calls = [];
  const reporter = new Proxy({}, { get: (_, name) => (...args) => calls.push({ name, args }) });

  return { reporter, calls };
}

describe("main", () => {
  it("runs with any reporter and returns the outcome instead of printing it", async () => {
    const { reporter, calls } = recordingReporter();

    const { failed } = await main({ root: RUN_FIXTURE, scriptName: "test", ff: false, reporter });

    assert.equal(failed, true);
    const started = calls.filter((call) => call.name === "printWorkspaceStart").map((call) => call.args[0]);
    assert.deepEqual(started, ["fail-ws", "pass-ws", "custom-runner-ws"]);
    const [completed] = calls.find((call) => call.name === "printSummary").args;
    assert.deepEqual(completed.map((result) => [result.workspace.name, result.exitCode === 0]), [
      ["fail-ws", false],
      ["pass-ws", true],
      ["custom-runner-ws", true]
    ]);
  });
});
