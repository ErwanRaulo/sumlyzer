import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Mimics a workspace whose test run writes an artifact inside itself (e.g. coverage),
// to make sure watch mode doesn't re-trigger on its own output.
writeFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "self-output.txt"), String(Date.now()));

console.log("ℹ tests 1");
console.log("ℹ pass 1");
console.log("ℹ fail 0");
console.log("ℹ duration_ms 1");
process.exit(0);
