import { readdirSync } from "node:fs";
import { join } from "node:path";
import { AstAnalyser } from "@nodesecure/js-x-ray";

const scanner = new AstAnalyser();
const findings = [];

const mjsFiles = (file) => file.endsWith(".mjs")

const files =  ["bin", "src"].flatMap((dir) =>
  readdirSync(dir, { recursive: true })
    .filter(mjsFiles)
    .map((file) => join(dir, file))
);

for (const file of files) {
  console.log(`Analyzing ${file}`);
  const { warnings } = await scanner.analyseFile(file);

  for (const {warning} of warnings) {
    console.log(`[${warning.severity}] ${file}: ${warning.kind}${warning.value ? ` (${warning.value})` : ""}`);
    if (warning.severity !== "Information") {
      findings.push({ file, ...warning });
    }
  }
}

if (findings.length > 0) {
  console.error(`\njs-x-ray: ${findings.length} security warning(s) found.`);
  process.exit(1);
}

console.log("js-x-ray: no security warnings found.");
