import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "sumlyzer-mcp-server.mjs");

const TEST_PATH = path.join(ROOT, "test");
const RUN_FIXTURE = path.join(TEST_PATH, "run-fixture");
const GLOB_WORKSPACES_FIXTURE = path.join(TEST_PATH, "glob-workspaces-fixture");
const NO_WORKSPACES_FIXTURE = path.join(TEST_PATH, "no-workspaces-fixture");

async function withClient(fn) {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN] });
  const client = new Client({ name: "sumlyzer-mcp-test-client", version: "0.0.0" });
  await client.connect(transport);
  try {
    return await fn(client);
  }
  finally {
    await client.close();
  }
}

function payloadOf(result) {
  return JSON.parse(result.content[0].text);
}

describe("sumlyzer-mcp-server sumlyzer_fail_fast_tests", () => {
  it("exposes a single sumlyzer_fail_fast_tests tool", async () => {
    await withClient(async (client) => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((tool) => tool.name), ["sumlyzer_fail_fast_tests"]);
    });
  });

  it("stops at the first failing workspace and reports its failure details", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: "sumlyzer_fail_fast_tests", arguments: { root: RUN_FIXTURE } });

      assert.equal(result.isError, undefined);
      const payload = payloadOf(result);
      assert.equal(payload.passed, 0);
      assert.equal(payload.failed, 1);
      assert.equal(payload.skipped, 2);
      assert.deepEqual(payload.skippedWorkspaces.toSorted(), ["custom-runner-ws", "pass-ws"]);
      assert.equal(payload.firstFailure.workspace, "fail-ws");
      assert.match(payload.firstFailure.failureDetails, /some assertion/);
    });
  });

  it("reports no failure when every eligible workspace passes", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: "sumlyzer_fail_fast_tests", arguments: { root: GLOB_WORKSPACES_FIXTURE } });

      assert.equal(result.isError, undefined);
      const payload = payloadOf(result);
      assert.equal(payload.passed, 2);
      assert.equal(payload.failed, 0);
      assert.equal(payload.firstFailure, null);
    });
  });

  it("returns a structured error when the project has no workspaces", async () => {
    await withClient(async (client) => {
      const result = await client.callTool({ name: "sumlyzer_fail_fast_tests", arguments: { root: NO_WORKSPACES_FIXTURE } });

      assert.equal(result.isError, true);
      assert.equal(payloadOf(result).error, "NoWorkspacesError");
    });
  });
});
