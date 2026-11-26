import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { formatSeconds, githubGroupSyntax, ciGroupTitle } from "../src/reporter.mjs";
import { workspaceName } from "../src/workspaces.mjs";

describe("workspaceName", () => {
  it("strips the workspaces/ prefix", () => {
    assert.equal(workspaceName("workspaces/utils"), "utils");
  });

  it("leaves paths without the prefix untouched", () => {
    assert.equal(workspaceName("packages/utils"), "packages/utils");
  });

  it("handles unexpected paths", () => {
    assert.equal(workspaceName(undefined), "");
    assert.equal(workspaceName(null), "");
    assert.equal(workspaceName(""), "");
  });
});

describe("formatSeconds", () => {
  it("formats milliseconds as seconds with one decimal", () => {
    assert.equal(formatSeconds(1234), "1.2s");
    assert.equal(formatSeconds(100), "0.1s");
  });

  it("formats non-numeric values as 0.0s instead of crashing or printing NaN", () => {
    assert.equal(formatSeconds(undefined), "0.0s");
    assert.equal(formatSeconds(null), "0.0s");
  });
});

describe("ciGroupSyntax", () => {
  it("returns GitHub Actions ::group:: syntax when GITHUB_ACTIONS=true", () => {
    const group = githubGroupSyntax({ GITHUB_ACTIONS: "true" });

    assert.equal(group.start("✓ utils 1.1s"), "::group::✓ utils 1.1s");
    assert.equal(group.end(), "::endgroup::");
  });

  it("returns null outside of GitHub Actions, so callers fall back to plain output", () => {
    assert.equal(githubGroupSyntax({}), null);
    assert.equal(githubGroupSyntax({ GITHUB_ACTIONS: "false" }), null);
    assert.equal(githubGroupSyntax({ GITLAB_CI: "true" }), null);
  });
});

describe("ciGroupTitle", () => {
  it("marks a passing workspace with a checkmark and its test counts", () => {
    const title = ciGroupTitle("utils", { exitCode: 0, durationMs: 1100, counts: { pass: "9", tests: "9" } });

    assert.equal(title, "✓ utils 1.1s (9/9 tests)");
  });

  it("marks a failing workspace with a cross, still including its test counts", () => {
    const title = ciGroupTitle("flags", { exitCode: 1, durationMs: 1300, counts: { pass: "8", tests: "9" } });

    assert.equal(title, "✗ flags 1.3s (8/9 tests)");
  });

  it("omits the counts label when node:test own counts couldn't be parsed", () => {
    const title = ciGroupTitle("broken", { exitCode: 1, durationMs: 400, counts: null });

    assert.equal(title, "✗ broken 0.4s");
  });
});
