#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "../src/mcpServer.mjs";

try {
  await createServer().connect(new StdioServerTransport());
}
catch (error) {
  console.error(`sumlyzer-mcp-server: failed to start (${error.message})`);
  process.exit(1);
}
