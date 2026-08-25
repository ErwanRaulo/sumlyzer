import { execFile } from "node:child_process";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function git(args, cwd) {
  return execFileAsync("git", args, { cwd });
}

export async function commitAll(dir, message) {
  await git(["add", "-A"], dir);
  await git(["-c", "user.email=test@sumlyzer.dev", "-c", "user.name=sumlyzer tests", "commit", "-q", "-m", message], dir);
}

export async function copyFixture(fixture, prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  await cp(fixture, dir, { recursive: true });
  return dir;
}

// Runs fn(dir) against a fresh temp dir, always cleaning it up afterward
// (even if fn throws or an assertion fails).
export async function withTempDir(prefix, fn) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    return await fn(dir);
  }
  finally {
    await rm(dir, { recursive: true, force: true });
  }
}
