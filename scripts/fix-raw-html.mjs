// Escape every raw `<` and `>` inside `<code …>…</code>` blocks of README.html
// so the browser stops parsing them as real DOM elements.
//
// Rules:
//   - Only the inner text between `<code …>` and `</code>` is touched.
//   - We carefully avoid double-escaping: if a `&` already starts a known
//     entity (`&lt;`, `&gt;`, `&amp;`, `&quot;`, `&#…;`), it's left alone.
//   - Raw `&` that don't already form an entity become `&amp;`.
//   - Raw `<` and `>` become `&lt;` / `&gt;`.
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const path = resolve(here, "../README.html");
const src = await readFile(path, "utf8");

const ENTITY_RE = /^(?:lt|gt|amp|quot|apos|nbsp|#\d+|#x[0-9a-fA-F]+);/;

function escapeInner(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "&") {
      if (ENTITY_RE.test(text.slice(i + 1))) {
        out += "&";
      } else {
        out += "&amp;";
      }
    } else if (ch === "<") {
      out += "&lt;";
    } else if (ch === ">") {
      out += "&gt;";
    } else {
      out += ch;
    }
  }
  return out;
}

let replaced = 0;
const fixed = src.replace(
  /(<code(?:\s[^>]*)?>)([\s\S]*?)(<\/code>)/g,
  (_full, open, inner, close) => {
    const next = escapeInner(inner);
    if (next !== inner) replaced++;
    return open + next + close;
  },
);

if (fixed === src) {
  console.log("Nothing to change — file already clean.");
} else {
  await writeFile(path, fixed, "utf8");
  console.log(`Rewrote ${replaced} <code> block(s) in README.html`);
}
