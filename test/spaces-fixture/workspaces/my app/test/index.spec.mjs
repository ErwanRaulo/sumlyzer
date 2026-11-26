import { test } from "node:test";
import assert from "node:assert/strict";

test("runs from a directory with a space", () => {
  assert.match(process.cwd(), /my app$/);
});
