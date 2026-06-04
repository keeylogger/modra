/**
 * Rebuild the `<section data-route="#/examples">…</section>` block inside
 * README.html from the eight files in /examples/.
 *
 * For each example we emit:
 *   • The (HTML-escaped) Modra source on the left
 *   • A sandboxed iframe pointing at /docs/demos/<n>-<name>.html on the right
 *   • A "View .modra source on GitHub" link
 *
 * The order of EXAMPLES below also drives the order on the live page.
 *
 *   $ node scripts/build-examples-section.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const EXAMPLES = [
  {
    file: "01-counter.modra",        demo: "01-counter.html",
    title: "Counter",
    blurb: "Reactive state, Actions, controlled buttons. The entire app is 13 lines of Modra; press +/− to see the <code>&lt;-</code> binding re-render.",
    height: 460,
  },
  {
    file: "02-todo-list.modra",      demo: "02-todo-list.html",
    title: "Todo list",
    blurb: "Array state, list mutation, derived text, two-way input via <code>InputField::Draft</code>, and <code>forEach</code> rendering.",
    height: 640,
  },
  {
    file: "03-registration.modra",   demo: "03-registration.html",
    title: "Registration (full-stack in one file)",
    blurb: "Postgres schema, server endpoint, hashed password, and a uniqueness constraint &mdash; all in a single declaration. The right panel shows the in-memory <code>DB.Users</code> table updating live.",
    height: 660,
  },
  {
    file: "04-blog.modra",           demo: "04-blog.html",
    title: "Tiny blog",
    blurb: "Multiple related tables, query endpoints, server-driven list, derived counts, and a comment form that adds rows to <code>DB.Comments</code>.",
    height: 660,
  },
  {
    file: "05-storefront.modra",     demo: "05-storefront.html",
    title: "Storefront with cart and checkout",
    blurb: "A fuller real-world app &mdash; product catalogue, cart state with quantities, a <code>Checkout</code> endpoint that wraps several DB inserts, and toast notifications.",
    height: 720,
  },
  {
    file: "06-dashboard.modra",      demo: "06-dashboard.html",
    title: "Admin dashboard",
    blurb: "Multiple endpoints, time-windowed queries (<code>Now() - Days(window)</code>), derived KPIs, and a compact UI built from primitives. Switch 7d / 14d / 30d to re-fetch.",
    height: 580,
  },
  {
    file: "07-realtime-chat.modra",  demo: "07-realtime-chat.html",
    title: "Realtime chat",
    blurb: "Channels, a polling endpoint, and a chat UI that streams the visible message list reactively. Type a message &mdash; another participant replies a moment later.",
    height: 640,
  },
  {
    file: "08-native-bridge.modra",  demo: "08-native-bridge.html",
    title: "Native bridges (Python, TypeScript, Bash)",
    blurb: "<code>Native&lt;Lang&gt;</code> blocks let Modra hand a problem off to another runtime. The compiler generates the subprocess wiring; you call it like a normal Modra action.",
    height: 660,
  },
];

// ─── helpers ──────────────────────────────────────────────────────────
function htmlEscape(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function htmlEscapeAttr(s) {
  return htmlEscape(s).replace(/"/g, "&quot;");
}

// ─── build the new section ────────────────────────────────────────────
function buildSection() {
  const articles = EXAMPLES.map((ex, idx) => {
    const src = readFileSync(resolve(root, "examples", ex.file), "utf8").trimEnd();
    const escapedSrc = htmlEscape(src);
    const n = String(idx + 1).padStart(2, "0");
    const githubUrl = "https://github.com/keeylogger/modra/blob/main/examples/" + ex.file;
    const demoUrl = "./docs/demos/" + ex.demo;
    const iframeTitle = ex.title + " demo";

    return [
      `          <article class="example-pair" id="ex-${n}">`,
      `            <header class="example-header">`,
      `              <h2>${idx + 1} &middot; ${ex.title}</h2>`,
      `              <a class="example-source-link" href="${githubUrl}" target="_blank" rel="noopener">View .modra source &nearr;</a>`,
      `            </header>`,
      `            <p class="example-summary">${ex.blurb}</p>`,
      `            <div class="example-grid">`,
      `              <div class="example-source">`,
      `                <div class="code-wrap"><span class="code-label">examples/${ex.file}</span><pre><code data-lang="modra">${escapedSrc}</code></pre></div>`,
      `              </div>`,
      `              <div class="example-preview">`,
      `                <div class="example-frame-bar">`,
      `                  <span class="example-frame-dot dot-r"></span>`,
      `                  <span class="example-frame-dot dot-y"></span>`,
      `                  <span class="example-frame-dot dot-g"></span>`,
      `                  <span class="example-frame-url">modra-runtime &middot; ${htmlEscape(ex.title.toLowerCase())}</span>`,
      `                  <a class="example-frame-open" href="${demoUrl}" target="_blank" rel="noopener" title="Open demo in a new tab">open &nearr;</a>`,
      `                </div>`,
      `                <iframe class="example-iframe" src="${demoUrl}" loading="lazy" sandbox="allow-scripts" title="${htmlEscapeAttr(iframeTitle)}" style="height:${ex.height}px"></iframe>`,
      `              </div>`,
      `            </div>`,
      `          </article>`,
      ``,
    ].join("\n");
  }).join("");

  return [
    `        <section data-route="#/examples" data-title="Example apps">`,
    `          <h1>Example apps</h1>`,
    `          <p class="lead">Each card below is a real Modra source on the left and the compiled React + Tailwind app on the right.`,
    `             The runtime is sandboxed in an iframe so you can poke at the UI live;`,
    `             backends use an in-memory stand-in for Postgres so demos stay self-contained.`,
    `             For the &lsquo;real&rsquo; emitted code (Node + SQL + RPC bridge), try the <a href="#/playground">playground</a>.</p>`,
    ``,
    `          <div class="example-toc">`,
    EXAMPLES.map((ex, i) => `            <a class="example-toc-link" href="#ex-${String(i + 1).padStart(2, "0")}">${i + 1}. ${ex.title}</a>`).join("\n"),
    `          </div>`,
    ``,
    articles.trimEnd(),
    `        </section>`,
    ``,
  ].join("\n");
}

// ─── splice into README.html ──────────────────────────────────────────
const htmlPath = resolve(root, "README.html");
let html = readFileSync(htmlPath, "utf8");

const startRx = /([ \t]*)<section data-route="#\/examples"[^>]*>/;
const startMatch = html.match(startRx);
if (!startMatch) {
  console.error("Could not find #/examples section opening tag");
  process.exit(1);
}
const startIdx = startMatch.index;
const closeRx = /<\/section>/g;
closeRx.lastIndex = startIdx;
const closeMatch = closeRx.exec(html);
if (!closeMatch) {
  console.error("Could not find closing </section> for #/examples");
  process.exit(1);
}
const endIdx = closeMatch.index + closeMatch[0].length;

const newSection = buildSection().trimEnd();
const before = html.slice(0, startIdx);
const after  = html.slice(endIdx);

const updated = before + newSection + after;
writeFileSync(htmlPath, updated);

console.log(`Rebuilt #/examples section with ${EXAMPLES.length} examples.`);
