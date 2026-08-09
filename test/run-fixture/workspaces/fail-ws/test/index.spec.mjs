import { test } from "node:test";
import assert from "node:assert/strict";

test("passes fine", () => {
  assert.equal(1 + 1, 2);
});

test("also passes fine", () => {
  assert.equal(2 + 2, 4);
});

test("some assertion", () => {
  assert.equal(1 + 1, 3);
});

test("another assertion", () => {
  assert.equal(2 + 2, 5);
});
