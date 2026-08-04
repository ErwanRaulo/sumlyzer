import { readFileSync } from "node:fs";
import path from "node:path";

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function buildDependentsGraph(root, workspaces) {
  const nameToPath = new Map();
  const depsByPath = new Map();

  for (const wsPath of workspaces) {
    let pkg;
    try {
      pkg = readJson(path.join(root, wsPath, "package.json"));
    }
    catch {
      continue;
    }

    if (pkg.name) {
      nameToPath.set(pkg.name, wsPath);
    }
    depsByPath.set(wsPath, { ...pkg.dependencies, ...pkg.devDependencies });
  }

  const dependents = new Map(workspaces.map((wsPath) => [wsPath, new Set()]));

  for (const [wsPath, deps] of depsByPath) {
    for (const depName of Object.keys(deps)) {
      const depPath = nameToPath.get(depName);
      if (depPath && depPath !== wsPath) {
        dependents.get(depPath).add(wsPath);
      }
    }
  }

  return dependents;
}

export function expandWithDependents(changedPaths, dependentsGraph) {
  const result = new Set();
  const queue = [...changedPaths];

  while (queue.length > 0) {
    const wsPath = queue.pop();
    if (result.has(wsPath)) {
      continue;
    }
    result.add(wsPath);

    for (const dependent of dependentsGraph.get(wsPath) ?? []) {
      if (!result.has(dependent)) {
        queue.push(dependent);
      }
    }
  }

  return result;
}
