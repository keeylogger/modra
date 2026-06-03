/**
 * Bundle the Modra compiler library for the browser.
 *
 * Produces `docs/modra-bundle.js` — an IIFE that exposes a global
 * `Modra` namespace with `parse`, `analyze`, `emitProject`, etc.
 *
 * Node-only imports (`node:fs`, `node:path`, etc.) are NOT used by
 * the library — only the CLI uses them, and we don't bundle the CLI.
 * If a future change introduces a Node import into the library, this
 * build will fail with a clear message.
 */

import { build } from "esbuild";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const result = await build({
  entryPoints: [resolve(root, "src/index.ts")],
  bundle: true,
  format: "iife",
  globalName: "Modra",
  platform: "browser",
  target: "es2020",
  sourcemap: false,
  minify: true,
  write: false,
  legalComments: "none",
  define: {
    "process.env.NODE_ENV": '"production"',
  },
  // Defensive: esbuild's IIFE output declares `var Modra = (...)()` at the
  // script top-level. In a regular <script> that becomes window.Modra, but
  // a) some hosting providers serve the file as a module and b) some
  // tooling/browsers occasionally surprise us. Forcing the assignment
  // costs ~25 bytes and removes an entire class of "playground silently
  // does nothing" bug reports.
  footer: {
    js: "try{(typeof globalThis!==\"undefined\"?globalThis:self).Modra=Modra;}catch(e){}",
  },
  external: [],
  logLevel: "info",
});

const out = result.outputFiles[0];
if (!out) {
  console.error("esbuild produced no output");
  process.exit(1);
}

writeFileSync(resolve(root, "docs/modra-bundle.js"), out.text, "utf8");
const kb = (out.text.length / 1024).toFixed(1);
console.log(`Wrote docs/modra-bundle.js (${kb} KB)`);
