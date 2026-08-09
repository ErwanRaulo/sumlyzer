import { test } from "node:test";
import assert from "node:assert/strict";

test("adds numbers", () => {
  assert.equal(1 + 1, 2);
});

test("subtracts numbers", () => {
  assert.equal(2 - 1, 1);
});

test("multiplies numbers", () => {
  assert.equal(2 * 2, 4);
});
