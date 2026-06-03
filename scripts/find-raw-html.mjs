// Scan README.html for raw `<X>`/`</X>` markup (X = ASCII letter) inside
// `<code …>…</code>` blocks. Such tags get parsed as real HTML by the browser
// and corrupt the surrounding DOM. They need to be escaped as `&lt;…&gt;`.
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = await readFile(resolve(here, "../README.html"), "utf8");

// Build a line index so we can report nice line numbers.
const lineStarts = [0];
for (let i = 0; i < src.length; i++) if (src.charCodeAt(i) === 10) lineStarts.push(i + 1);
const lineOf = (off) => {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= off) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
};

const codeRx = /<code(\s[^>]*)?>([\s\S]*?)<\/code>/g;
const tagRx = /<\/?([A-Za-z][A-Za-z0-9]*)\b/g;
const offenders = [];

let m;
while ((m = codeRx.exec(src)) !== null) {
  const inner = m[2];
  const innerStart = m.index + m[0].indexOf(inner);
  let t;
  tagRx.lastIndex = 0;
  while ((t = tagRx.exec(inner)) !== null) {
    offenders.push({
      line: lineOf(innerStart + t.index),
      tag:  t[0],
      hint: inner.slice(Math.max(0, t.index - 20), t.index + 50).replace(/\n/g, "⏎"),
    });
  }
}

if (!offenders.length) {
  console.log("Clean: no raw HTML tags inside <code> blocks.");
} else {
  console.log(`Found ${offenders.length} raw tag(s) inside <code> blocks:\n`);
  for (const o of offenders) {
    console.log(`  line ${o.line}: ${o.tag}    …${o.hint}…`);
  }
}
