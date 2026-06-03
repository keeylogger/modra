/**
 * Sanity-check the generated docs site.
 * Validates that:
 *  - README.html exists and contains all expected routes
 *  - The Modra browser bundle is present and exports a usable API
 *  - Each example in playground.js parses cleanly
 *  - Section/route counts line up with the sidebar nav
 */

import { readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

function ok(msg)   { console.log("  ✓ " + msg); }
function bad(msg)  { console.error("  ✗ " + msg); process.exitCode = 1; }

console.log("Verifying README.html …");
const html = readFileSync(resolve(root, "README.html"), "utf8");

const routes = [...html.matchAll(/data-route="([^"]+)"/g)].map((m) => m[1]);
const navHrefs = [...html.matchAll(/class="nav-link"\s+href="([^"]+)"/g)].map((m) => m[1]);
const sections = (html.match(/<section /g) || []).length;
const sectionCloses = (html.match(/<\/section>/g) || []).length;

ok(`${routes.length} routed sections`);
ok(`${navHrefs.length} nav links`);
if (sections !== sectionCloses) bad(`section open/close mismatch: ${sections} vs ${sectionCloses}`);
else ok(`section open/close balanced (${sections})`);

const missing = navHrefs.filter((h) => !routes.includes(h));
if (missing.length) bad(`Nav links with no section: ${missing.join(", ")}`);
else ok("Every nav link maps to a routed section");

const unreferenced = routes.filter((r) => !navHrefs.includes(r));
if (unreferenced.length) console.log(`  · ${unreferenced.length} routed section(s) not in sidebar: ${unreferenced.join(", ")}`);

console.log("\nVerifying docs/modra-bundle.js …");
const bundlePath = resolve(root, "docs/modra-bundle.js");
const stat = statSync(bundlePath);
ok(`bundle exists (${(stat.size / 1024).toFixed(1)} KB)`);
const bundleSrc = readFileSync(bundlePath, "utf8");
const sandbox = {};
const fn = new Function("globalThis", bundleSrc + "; return globalThis.Modra || Modra;");
const Modra = fn(sandbox);
for (const sym of ["Scanner", "Parser", "parse", "analyze", "emitProject", "describeTokenType"]) {
  if (typeof Modra[sym] === "undefined") bad(`bundle missing export: ${sym}`);
  else ok(`bundle exports ${sym}`);
}

console.log("\nVerifying each playground example compiles …");
const pgSrc = readFileSync(resolve(root, "docs/playground.js"), "utf8");
const exMatch = pgSrc.match(/const EXAMPLES = \{([\s\S]*?)\n  \};/);
if (!exMatch) bad("Could not find EXAMPLES block in playground.js");
else {
  // Lazy parse: pull out each `name: \`...\`` chunk.
  const exampleRe = /(\w+):\s*`([\s\S]*?)`/g;
  let m;
  let total = 0;
  while ((m = exampleRe.exec(exMatch[1]))) {
    total++;
    const [_, name, src] = m;
    try {
      const r = Modra.parse(src, `${name}.modra`);
      if (r.diagnostics.length) bad(`${name}: ${r.diagnostics.length} parser diag(s) — ${r.diagnostics[0].message}`);
      else {
        const a = Modra.analyze(r.ast, `${name}.modra`);
        if (a.hasErrors) bad(`${name}: ${a.diagnostics.filter((d)=>d.severity!=="warning").length} semantic error(s) — ${a.diagnostics[0].message}`);
        else {
          const e = Modra.emitProject(a);
          ok(`${name}: parse + analyze + emit OK (${e.files.length} files)`);
        }
      }
    } catch (err) {
      bad(`${name} threw: ${err.message}`);
    }
  }
  ok(`checked ${total} example(s)`);
}

console.log("\nVerifying every Modra code block inside README.html …");
const htmlBlockRe = /<code\s+data-lang="modra">([\s\S]*?)<\/code>/g;
function unescape(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
let blockIdx = 0;
let blockBad = 0;
let m;
while ((m = htmlBlockRe.exec(html))) {
  blockIdx++;
  const src = unescape(m[1]).trimEnd();
  const r = Modra.parse(src, `block-${blockIdx}.modra`);
  const errs = r.diagnostics.filter((d) => d.severity !== "warning");
  if (errs.length) {
    blockBad++;
    bad(`block #${blockIdx}: ${errs[0].message}`);
  }
}
if (!blockBad) ok(`all ${blockIdx} Modra code blocks parse cleanly`);

console.log("\nVerifying every Modra code block inside README.md …");
const md = readFileSync(resolve(root, "README.md"), "utf8");
const mdRe = /```modra\r?\n([\s\S]*?)```/g;
let mdIdx = 0, mdBad = 0, mdMatch;
while ((mdMatch = mdRe.exec(md))) {
  mdIdx++;
  const src = mdMatch[1].replace(/\n$/, "");
  const r = Modra.parse(src, `md-${mdIdx}.modra`);
  const errs = r.diagnostics.filter((d) => d.severity !== "warning");
  if (errs.length) {
    mdBad++;
    bad(`README.md block #${mdIdx}: ${errs[0].message}`);
  }
}
if (!mdBad) ok(`all ${mdIdx} README.md Modra blocks parse cleanly`);

// ─── No raw HTML inside <code> blocks ─────────────────────────
// Raw `<X>` tags inside a code block get parsed as real DOM elements by
// the browser, which corrupts surrounding sections (this exact bug took
// the live playground offline once already — see CHANGELOG).
console.log("\nChecking that <code> blocks don't contain raw HTML tags …");
const codeRx = /<code(?:\s[^>]*)?>([\s\S]*?)<\/code>/g;
const tagRx = /<\/?[A-Za-z][A-Za-z0-9]*\b/g;
let rawTagCount = 0;
let cm;
while ((cm = codeRx.exec(html))) {
  const inner = cm[1];
  const hits = inner.match(tagRx);
  if (hits) rawTagCount += hits.length;
}
if (rawTagCount === 0) {
  ok("no raw HTML tags inside <code> blocks");
} else {
  bad(`${rawTagCount} raw HTML tag(s) inside <code> blocks — run \`node scripts/fix-raw-html.mjs\``);
}

if (process.exitCode) {
  console.error("\nVerification failed.");
} else {
  console.log("\nAll docs checks passed.");
}
