// Verifies every `examples/*.modra` file parses cleanly through the actual
// Modra compiler. Run as `node scripts/verify-examples.mjs`.
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// Load the browser bundle in a vm context — same trick as docs:verify uses.
const bundleSrc = readFileSync(resolve(root, "docs/modra-bundle.js"), "utf8");
const sandbox = { console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(bundleSrc, sandbox);
const Modra = sandbox.Modra || sandbox.globalThis.Modra;
if (!Modra) {
  console.error("Could not load the Modra bundle. Run `npm run docs` first.");
  process.exit(1);
}

const dir = resolve(root, "examples");
const files = readdirSync(dir).filter((f) => f.endsWith(".modra")).sort();

if (files.length === 0) {
  console.error("No .modra files found in examples/.");
  process.exit(1);
}

console.log(`Verifying ${files.length} example(s) in examples/ …\n`);

let badFiles = 0;
let totalErrors = 0;
let totalWarnings = 0;

for (const file of files) {
  const src = readFileSync(resolve(dir, file), "utf8");
  const r = Modra.parse(src, file);
  const errors   = r.diagnostics.filter((d) => d.severity === "error");
  const warnings = r.diagnostics.filter((d) => d.severity === "warning");

  totalErrors   += errors.length;
  totalWarnings += warnings.length;

  if (errors.length === 0) {
    const tag = warnings.length ? `  (${warnings.length} warning${warnings.length === 1 ? "" : "s"})` : "";
    console.log(`  ✓ ${file}${tag}`);
  } else {
    badFiles++;
    console.error(`  ✗ ${file}  (${errors.length} error${errors.length === 1 ? "" : "s"})`);
    for (const err of errors.slice(0, 5)) {
      const line = err.span && err.span.start ? err.span.start.line : "?";
      const col  = err.span && err.span.start ? err.span.start.column : "?";
      console.error(`      ${line}:${col}  ${err.code || "ERR"}: ${err.message}`);
    }
    if (errors.length > 5) console.error(`      … (${errors.length - 5} more)`);
  }
}

console.log("");
if (badFiles === 0) {
  console.log(`All ${files.length} example(s) parsed cleanly. ` +
              `(${totalWarnings} warning${totalWarnings === 1 ? "" : "s"} total)`);
} else {
  console.error(`${badFiles} example(s) failed to parse.`);
  process.exitCode = 1;
}
