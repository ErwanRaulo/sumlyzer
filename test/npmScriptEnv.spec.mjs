import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { npmScriptEnv } from "../src/npmScriptEnv.mjs";

const PKG_DIR = path.resolve("workspaces", "app");

describe("npmScriptEnv", () => {
  it("sets the lifecycle and package.json path variables", () => {
    const env = npmScriptEnv({ pkg: {}, pkgDir: PKG_DIR, event: "pretest", script: "node check.mjs" });

    assert.deepEqual(env, {
      npm_package_json: path.join(PKG_DIR, "package.json"),
      npm_lifecycle_event: "pretest",
      npm_lifecycle_script: "node check.mjs"
    });
  });

  it("exposes name, version, config, engines and bin, and nothing else from package.json", () => {
    const pkg = {
      name: "app",
      version: "1.2.3",
      description: "not exposed",
      scripts: { test: "not exposed" },
      dependencies: { glob: "not exposed" },
      config: { port: 8080 },
      engines: { node: ">=22" },
      bin: { app: "bin/app.mjs" }
    };

    const env = npmScriptEnv({ pkg, pkgDir: PKG_DIR, event: "test", script: "node --test" });

    assert.deepEqual(Object.keys(env).filter((key) => key.startsWith("npm_package_")).sort(), [
      "npm_package_bin_app",
      "npm_package_config_port",
      "npm_package_engines_node",
      "npm_package_json",
      "npm_package_name",
      "npm_package_version"
    ]);
    assert.equal(env.npm_package_config_port, "8080");
  });

  it("flattens nested objects and indexes arrays like npm", () => {
    const pkg = { config: { db: { host: "localhost", ports: [5432, 5433] } } };

    const env = npmScriptEnv({ pkg, pkgDir: PKG_DIR, event: "test", script: "x" });

    assert.equal(env.npm_package_config_db_host, "localhost");
    assert.equal(env.npm_package_config_db_ports_0, "5432");
    assert.equal(env.npm_package_config_db_ports_1, "5433");
  });

  it("maps null and false to an empty string and skips undefined", () => {
    const pkg = { config: { empty: null, off: false, on: true, missing: undefined } };

    const env = npmScriptEnv({ pkg, pkgDir: PKG_DIR, event: "test", script: "x" });

    assert.equal(env.npm_package_config_empty, "");
    assert.equal(env.npm_package_config_off, "");
    assert.equal(env.npm_package_config_on, "true");
    assert.equal("npm_package_config_missing" in env, false);
  });

  it("exposes nothing for a string bin, like npm", () => {
    const env = npmScriptEnv({ pkg: { name: "app", bin: "bin/app.mjs" }, pkgDir: PKG_DIR, event: "test", script: "x" });

    assert.deepEqual(Object.keys(env).filter((key) => key.startsWith("npm_package_bin")), []);
  });
});
