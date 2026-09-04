import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { main } from "./run.mjs";
import { workspaceName } from "./reporter.mjs";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

// Keeps a single large failure from blowing up an agent's context; the workspace
// path is still returned so it can inspect the full output directly if needed.
const CHARACTER_LIMIT = 10000;

function truncate(text) {
  if (typeof text !== "string" || text.length <= CHARACTER_LIMIT) {
    return text;
  }
  return `${text.slice(0, CHARACTER_LIMIT)}\n\n[truncated ${text.length - CHARACTER_LIMIT} more characters — inspect the workspace directly for the full output]`;
}

function summarizeFailure(result) {
  return {
    workspace: workspaceName(result.wsPath),
    exitCode: result.exitCode,
    failingTests: result.failingTests,
    failureDetails: truncate(result.failureDetails),
    rawOutput: truncate(result.rawOutput)
  };
}

function toolResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function errorResult(error) {
  const { name: errorName, message, entries, wsPath, scriptName, ref } = error;
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify({ error: errorName ?? "Error", message, entries, wsPath, scriptName, ref }, null, 2) }]
  };
}

function buildRunSummary(completed, skipped) {
  const failed = completed.filter((result) => result.exitCode !== 0);

  return {
    passed: completed.length - failed.length,
    failed: failed.length,
    skipped: skipped.length,
    skippedWorkspaces: skipped.map(workspaceName),
    firstFailure: failed.length > 0 ? summarizeFailure(failed[0]) : null
  };
}

const inputSchema = z.object({
  root: z.string().optional().describe("Absolute path to the monorepo root. Defaults to the server process's current working directory."),
  script: z.string().default("test").describe("npm script name to run in each workspace."),
  changed: z.boolean().default(false).describe("Only run workspaces changed since the git ref (see \"ref\")."),
  ref: z.string().optional().describe("Git ref to diff against when changed=true. Defaults to an auto-detected ref."),
  concurrency: z.number().int().positive().default(1).describe("Max workspaces to run in parallel before the first failure.")
}).strict();

const description = `Runs each npm workspace's test script, stopping at the first failing workspace. Read-only from the caller's perspective: it does not modify any files itself (though a workspace's own script might).

Args:
  - root (string, optional): absolute path to the monorepo root. Defaults to the server's cwd.
  - script (string, optional): npm script name to run per workspace (default: "test").
  - changed (boolean, optional): only run workspaces with changes since "ref" (default: false).
  - ref (string, optional): git ref to diff against when changed=true (default: auto-detected).
  - concurrency (number, optional): max workspaces to run in parallel before the first failure (default: 1).

Returns JSON: { passed, failed, skipped, skippedWorkspaces, firstFailure } where firstFailure is
{ workspace, exitCode, failingTests, failureDetails, rawOutput } or null when nothing failed.

Use when: "run the tests and fix the first failure" -> call with root set to the monorepo, fix the
reported failure, then call again to move to the next one.`;

export function createServer() {
  const server = new McpServer({ name: "sumlyzer-mcp-server", version });

  server.registerTool("sumlyzer_fail_fast_tests", {
    title: "Run workspace tests (fail-fast)",
    description,
    inputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false
    }
  }, async ({ root, script, changed, ref, concurrency }) => {
    try {
      const { completed, skipped } = await main({
        root: root ?? process.cwd(),
        scriptName: script,
        ff: true,
        junitPath: undefined,
        concurrency,
        changed,
        ref,
        watch: false,
        quiet: true
      });

      return toolResult(buildRunSummary(completed, skipped));
    }
    catch (error) {
      return errorResult(error);
    }
  });

  return server;
}
