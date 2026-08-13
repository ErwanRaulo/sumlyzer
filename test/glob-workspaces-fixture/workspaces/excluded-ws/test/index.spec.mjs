import { test } from "node:test";
import assert from "node:assert/strict";

test("must never run: this workspace is excluded via a negated glob pattern", () => {
  assert.fail("excluded-ws ran even though '!workspaces/excluded-ws' should have skipped it");
});
