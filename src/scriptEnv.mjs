import path from "node:path";

import { npmScriptEnv } from "./npmScriptEnv.mjs";
import { withPath } from "./pathEnv.mjs";
import { runner } from "./runner.mjs";

// node_modules/.bin of the workspace and each parent up to the root, like npm run.
function binPath(root, cwd) {
  const rootDir = path.resolve(root);
  const binDirs = [];
  let dir = path.resolve(cwd);

  while (true) {
    binDirs.push(path.join(dir, "node_modules", ".bin"));
    const parent = path.dirname(dir);
    if (dir === rootDir || parent === dir) {
      break;
    }
    dir = parent;
  }

  return [...binDirs, process.env.PATH].join(path.delimiter);
}

// Only the main script gets the runner's reporter: a hook running its own
// `node --test` would otherwise overwrite the main script's counts and JUnit report.
export function scriptEnv({ root, workspace, phase, junitDestPath }) {
  const cwd = path.join(root, workspace.path);
  const base = phase.isMain ? runner.prepareEnv(process.env, junitDestPath) : process.env;

  return withPath(
    { ...base, ...npmScriptEnv({ pkg: workspace.pkg, pkgDir: cwd, event: phase.event, script: phase.command }) },
    binPath(root, cwd)
  );
}
