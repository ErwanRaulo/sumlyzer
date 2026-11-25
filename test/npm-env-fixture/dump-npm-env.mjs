import { writeFileSync } from "node:fs";
import path from "node:path";

const npmVars = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => key.startsWith("npm_package_") || key.startsWith("npm_lifecycle_"))
);

writeFileSync(path.join(process.env.NPM_ENV_MARKER_DIR, `${process.env.npm_lifecycle_event}.json`), JSON.stringify(npmVars));
