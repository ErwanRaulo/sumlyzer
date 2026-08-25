import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

import { getChangedFiles, resolveDefaultRef, selectChangedWorkspaces } from "../src/changed.mjs";
import { GitDiffError } from "../src/errors.mjs";
import { git, commitAll, withTempDir } from "./gitTestHelpers.mjs";

const WORKSPACES = ["workspaces/app-a", "workspaces/app-b"];

// Runs fn(dir, baseline) against a fresh repo with a single "baseline" commit,
// cleaning the repo up afterward.
async function withGitRepo(fn) {
  return withTempDir("sumlyzer-changed-unit-", async (dir) => {
    await git(["init", "-q"], dir);
    await writeFile(path.join(dir, "file.txt"), "baseline\n");
    await commitAll(dir, "baseline");
    const { stdout: baseline } = await git(["rev-parse", "HEAD"], dir);

    return fn(dir, baseline.trim());
  });
}

describe("getChangedFiles", () => {
  it("throws a GitDiffError when the cwd isn't a git repository", async () => {
    await withTempDir("sumlyzer-changed-unit-", (dir) => {
      assert.throws(() => getChangedFiles(dir, "HEAD"), GitDiffError);
    });
  });
});

describe("resolveDefaultRef", () => {
  it("resolves to HEAD when the working tree has uncommitted changes", async () => {
    await withGitRepo(async (dir) => {
      await writeFile(path.join(dir, "file.txt"), "dirty\n");

      const result = resolveDefaultRef(dir);

      assert.deepEqual(result, { ref: "HEAD", label: "HEAD", reason: "uncommitted changes" });
    });
  });

  it("resolves to HEAD when the tree is clean and no upstream is configured", async () => {
    await withGitRepo(async (dir) => {
      const result = resolveDefaultRef(dir);

      assert.deepEqual(result, { ref: "HEAD", label: "HEAD", reason: "no upstream configured" });
    });
  });

  it("resolves to the merge-base with the upstream when the tree is clean", async () => {
    await withGitRepo(async (dir, baseline) => {
      // Stand in for a real remote-tracking branch: any ref name works for @{u} resolution.
      await git(["branch", "origin/main"], dir);
      await git(["branch", "--set-upstream-to=origin/main"], dir);
      await writeFile(path.join(dir, "file.txt"), "ahead\n");
      await commitAll(dir, "ahead of upstream");

      const result = resolveDefaultRef(dir);

      assert.equal(result.ref, baseline);
      assert.equal(result.reason, "no local changes");
      assert.match(result.label, /origin\/main/);
    });
  });
});

describe("selectChangedWorkspaces", () => {
  it("attributes a changed file to its owning workspace", () => {
    const { workspaces, rootChangeFiles } = selectChangedWorkspaces(WORKSPACES, ["workspaces/app-a/test/index.spec.mjs"]);

    assert.deepEqual([...workspaces], ["workspaces/app-a"]);
    assert.deepEqual(rootChangeFiles, []);
  });

  it("attributes changes across multiple workspaces", () => {
    const { workspaces } = selectChangedWorkspaces(WORKSPACES, [
      "workspaces/app-a/src/index.mjs",
      "workspaces/app-b/src/index.mjs"
    ]);

    assert.deepEqual([...workspaces].sort(), ["workspaces/app-a", "workspaces/app-b"]);
  });

  it("does not attribute a change to an unrelated workspace", () => {
    const { workspaces } = selectChangedWorkspaces(WORKSPACES, ["workspaces/app-a/src/index.mjs"]);

    assert.equal(workspaces.has("workspaces/app-b"), false);
  });

  it("does not confuse a workspace with another sharing its name prefix", () => {
    const { workspaces, rootChangeFiles } = selectChangedWorkspaces(WORKSPACES, ["workspaces/app-a-extra/index.mjs"]);

    assert.equal(workspaces.size, 0);
    assert.deepEqual(rootChangeFiles, ["workspaces/app-a-extra/index.mjs"]);
  });

  it("reports a file outside every workspace as a root change", () => {
    const { workspaces, rootChangeFiles } = selectChangedWorkspaces(WORKSPACES, ["package.json"]);

    assert.equal(workspaces.size, 0);
    assert.deepEqual(rootChangeFiles, ["package.json"]);
  });

  it("resolves a nested workspace to its innermost match", () => {
    const nested = ["workspaces/app-a", "workspaces/app-a/nested"];
    const { workspaces } = selectChangedWorkspaces(nested, ["workspaces/app-a/nested/src/index.mjs"]);

    assert.deepEqual([...workspaces], ["workspaces/app-a/nested"]);
  });
});
