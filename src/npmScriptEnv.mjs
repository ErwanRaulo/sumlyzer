import path from "node:path";

// Mirrors @npmcli/run-script: package fields flattened to npm_package_<path>,
// with arrays indexed, null/false as "" and undefined skipped.
function flattenPackageFields(fields, prefix, env = {}) {
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    if (value === null || value === false) {
      env[`${prefix}${key}`] = "";
    }
    else if (Array.isArray(value)) {
      value.forEach((item, index) => flattenPackageFields({ [`${key}_${index}`]: item }, prefix, env));
    }
    else if (typeof value === "object") {
      flattenPackageFields(value, `${prefix}${key}_`, env);
    }
    else {
      env[`${prefix}${key}`] = String(value);
    }
  }

  return env;
}

// The variables npm run sets for a lifecycle script, so a workspace script behaves
// the same under sumlyzer. Only the fields npm itself exposes (npm/rfcs#183).
export function npmScriptEnv({ pkg, pkgDir, event, script }) {
  return {
    ...flattenPackageFields({
      name: pkg.name,
      version: pkg.version,
      config: pkg.config,
      engines: pkg.engines,
      // npm exposes nothing for a string "bin", only for the object form.
      bin: typeof pkg.bin === "object" ? pkg.bin : undefined
    }, "npm_package_"),
    npm_package_json: path.resolve(pkgDir, "package.json"),
    npm_lifecycle_event: event,
    npm_lifecycle_script: script
  };
}
