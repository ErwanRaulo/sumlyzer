import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { buildJunitReport } from "./junit.mjs";
import { red, dim, workspaceName } from "./reporter.mjs";

const DEFAULT_JUNIT_FILENAME = "junit.xml";

async function collectJunitEntries(results) {
  const entries = [];
  const missing = [];

  for (const result of results) {
    if (!result.junitDestPath) {
      continue;
    }
    try {
      entries.push({ name: workspaceName(result.wsPath), xml: await readFile(result.junitDestPath, "utf8") });
    }
    catch {
      missing.push(workspaceName(result.wsPath));
    }
  }

  return { entries, missing };
}

async function resolveDestination(root, junitPath) {
  const destination = path.resolve(root, junitPath);
  const isDirectory = await stat(destination).then((stats) => stats.isDirectory(), () => false);

  return isDirectory ? path.join(destination, DEFAULT_JUNIT_FILENAME) : destination;
}

export async function writeJunitReport(root, junitPath, results) {
  const { entries, missing } = await collectJunitEntries(results);
  const destination = await resolveDestination(root, junitPath);

  if (missing.length > 0) {
    console.log(dim(`${missing.length} workspace(s) missing from the JUnit report: ${missing.join(", ")}`));
  }

  try {
    await writeFile(destination, buildJunitReport(entries));
  }
  catch (error) {
    console.error(red(`Could not write JUnit report to "${destination}" (${error.message})`));
    process.exitCode = 1;
  }
}
