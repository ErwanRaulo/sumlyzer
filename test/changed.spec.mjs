import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { getChangedFiles, resolveDefaultRef, selectChangedWorkspaces } from "../src/changed.mjs";
import { GitDiffError } from "../src/errors.mjs";

const execFileAsync = promisify(execFile);

const WORKSPACES = ["workspaces/app-a", "workspaces/app-b"];

async function git(args, cwd) {
  return execFileAsync("git", args, { cwd });
}

async function tempGitRepo() {
  const dir = await mkdtemp(path.join(tmpdir(), "sumlyzer-changed-unit-"));
  await git(["init", "-q"], dir);
  await writeFile(path.join(dir, "file.txt"), "baseline\n");
  await git(["add", "-A"], dir);
  await git(["-c", "user.email=test@sumlyzer.dev", "-c", "user.name=sumlyzer tests", "commit", "-q", "-m", "baseline"], dir);
  const { stdout: baseline } = await git(["rev-parse", "HEAD"], dir);

  return { dir, baseline: baseline.trim() };
}

describe("getChangedFiles", () => {
  it("throws a GitDiffError when the cwd isn't a git repository", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sumlyzer-changed-unit-"));

    try {
      assert.throws(() => getChangedFiles(dir, "HEAD"), GitDiffError);
    }
    finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("resolveDefaultRef", () => {
  it("resolves to HEAD when the working tree has uncommitted changes", async () => {
    const { dir } = await tempGitRepo();
    await writeFile(path.join(dir, "file.txt"), "dirty\n");

    const result = resolveDefaultRef(dir);

    assert.deepEqual(result, { ref: "HEAD", label: "HEAD", reason: "uncommitted changes" });
  });

  it("resolves to HEAD when the tree is clean and no upstream is configured", async () => {
    const { dir } = await tempGitRepo();

    const result = resolveDefaultRef(dir);

    assert.deepEqual(result, { ref: "HEAD", label: "HEAD", reason: "no upstream configured" });
  });

  it("resolves to the merge-base with the upstream when the tree is clean", async () => {
    const { dir, baseline } = await tempGitRepo();
    // Stand in for a real remote-tracking branch: any ref name works for @{u} resolution.
    await git(["branch", "origin/main"], dir);
    await git(["branch", "--set-upstream-to=origin/main"], dir);
    await writeFile(path.join(dir, "file.txt"), "ahead\n");
    await git(["add", "-A"], dir);
    await git(["-c", "user.email=test@sumlyzer.dev", "-c", "user.name=sumlyzer tests", "commit", "-q", "-m", "ahead of upstream"], dir);

    const result = resolveDefaultRef(dir);

    assert.equal(result.ref, baseline);
    assert.equal(result.reason, "no local changes");
    assert.match(result.label, /origin\/main/);
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
