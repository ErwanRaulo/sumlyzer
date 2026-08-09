import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { stripNpmNoise } from "../src/parseOutput.mjs";

describe("stripNpmNoise", () => {
  it("drops npm warn lines", () => {
    const output = 'npm warn Unknown env config "allow-git".\nℹ tests 1\n';
    assert.equal(stripNpmNoise(output), "ℹ tests 1\n");
  });
});
