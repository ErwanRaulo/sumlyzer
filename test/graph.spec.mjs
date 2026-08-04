import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildDependentsGraph, expandWithDependents } from "../src/graph.mjs";

async function makeWorkspace(root, wsPath, pkg) {
  const dir = path.join(root, wsPath);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "package.json"), JSON.stringify(pkg));
}

describe("buildDependentsGraph", () => {
  it("maps a workspace to the other workspaces that depend on it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sumlyzer-graph-"));
    try {
      await makeWorkspace(root, "workspaces/base", { name: "base" });
      await makeWorkspace(root, "workspaces/mid", { name: "mid", dependencies: { base: "*" } });
      await makeWorkspace(root, "workspaces/top", { name: "top", devDependencies: { mid: "*" } });

      const graph = buildDependentsGraph(root, ["workspaces/base", "workspaces/mid", "workspaces/top"]);

      assert.deepEqual([...graph.get("workspaces/base")], ["workspaces/mid"]);
      assert.deepEqual([...graph.get("workspaces/mid")], ["workspaces/top"]);
      assert.deepEqual([...graph.get("workspaces/top")], []);
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("ignores dependencies that aren't other workspaces", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sumlyzer-graph-"));
    try {
      await makeWorkspace(root, "workspaces/base", { name: "base", dependencies: { lodash: "^4.0.0" } });

      const graph = buildDependentsGraph(root, ["workspaces/base"]);

      assert.deepEqual([...graph.get("workspaces/base")], []);
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("skips a workspace whose package.json can't be read", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sumlyzer-graph-"));
    try {
      await mkdir(path.join(root, "workspaces/broken"), { recursive: true });

      const graph = buildDependentsGraph(root, ["workspaces/broken"]);

      assert.deepEqual([...graph.get("workspaces/broken")], []);
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("expandWithDependents", () => {
  it("returns the transitive closure of dependents", () => {
    const graph = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["c"])],
      ["c", new Set()]
    ]);

    assert.deepEqual([...expandWithDependents(["a"], graph)].sort(), ["a", "b", "c"]);
  });

  it("doesn't loop forever on a dependency cycle", () => {
    const graph = new Map([
      ["a", new Set(["b"])],
      ["b", new Set(["a"])]
    ]);

    assert.deepEqual([...expandWithDependents(["a"], graph)].sort(), ["a", "b"]);
  });

  it("returns just the changed workspace when nothing depends on it", () => {
    const graph = new Map([["a", new Set()]]);

    assert.deepEqual([...expandWithDependents(["a"], graph)], ["a"]);
  });
});
