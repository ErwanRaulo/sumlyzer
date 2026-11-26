import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { withPath } from "../src/pathEnv.mjs";

describe("withPath", () => {
  it("sets PATH on POSIX, where variable names are case-sensitive", () => {
    assert.deepEqual(withPath({ PATH: "/usr/bin", Path: "kept" }, "/bin", "linux"), { PATH: "/bin", Path: "kept" });
  });

  it("replaces Windows' own \"Path\" key instead of adding a second PATH entry", () => {
    const env = withPath({ Path: "C:\\Windows", HOME: "x" }, "C:\\bin", "win32");

    assert.deepEqual(env, { Path: "C:\\bin", HOME: "x" });
  });

  it("collapses every case variant into one entry on Windows", () => {
    const env = withPath({ PATH: "a", Path: "b", path: "c" }, "C:\\bin", "win32");

    assert.deepEqual(Object.keys(env).filter((key) => key.toUpperCase() === "PATH"), ["PATH"]);
    assert.equal(env.PATH, "C:\\bin");
  });

  it("adds Path on Windows when the environment has none", () => {
    assert.deepEqual(withPath({}, "C:\\bin", "win32"), { Path: "C:\\bin" });
  });

  it("does not mutate the given environment", () => {
    const env = { Path: "C:\\Windows" };
    withPath(env, "C:\\bin", "win32");

    assert.deepEqual(env, { Path: "C:\\Windows" });
  });
});
