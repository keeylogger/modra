/* =============================================================
   Modra Docs — SPA router
   -------------------------------------------------------------
   - Hash-based routing (`#/path`)
   - Hide/show sections, update active nav link + breadcrumbs
   - Lazy-mount the playground when visited
   - Theme toggle (persisted in localStorage)
   - Highlight all code blocks on first render
   - Comparison-page tab switcher
   ============================================================= */

(function () {
  "use strict";

  const $  = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const sections = $$("section[data-route]");
  const navLinks = $$(".nav-link");
  const crumb = $("#crumb-current");
  const sidebar = $("#sidebar");
  const backdrop = $("#backdrop");
  const menuToggle = $("#menu-toggle");
  const themeToggle = $("#theme-toggle");
  const themeIcon = $("#theme-icon");
  const html = document.documentElement;

  // ─── Theme ──────────────────────────────────────────────────
  function applyTheme(t) {
    html.setAttribute("data-theme", t);
    themeIcon.textContent = t === "dark" ? "☀️" : "🌙";
    try { localStorage.setItem("modra-theme", t); } catch (_) {}
  }
  try {
    const saved = localStorage.getItem("modra-theme");
    if (saved === "light" || saved === "dark") applyTheme(saved);
  } catch (_) {}
  themeToggle.addEventListener("click", () => {
    const next = html.getAttribute("data-theme") === "dark" ? "light" : "dark";
    applyTheme(next);
  });

  // ─── Routing ────────────────────────────────────────────────
  function normalize(hash) {
    if (!hash || hash === "#") return "#/";
    return hash;
  }

  function showRoute(hash) {
    const target = normalize(hash);
    let active = sections.find((s) => s.dataset.route === target);
    if (!active) active = sections.find((s) => s.dataset.route === "#/");
    sections.forEach((s) => { s.style.display = (s === active) ? "" : "none"; });

    navLinks.forEach((a) => {
      a.classList.toggle("active", a.getAttribute("href") === active.dataset.route);
    });
    crumb.textContent = active.dataset.title || "Docs";
    document.title = (active.dataset.title ? active.dataset.title + " · " : "") + "Modra";

    window.scrollTo({ top: 0, behavior: "auto" });

    if (active.dataset.route === "#/playground") mountPlayground();

    closeSidebar();
  }

  window.addEventListener("hashchange", () => showRoute(location.hash));

  // ─── Mobile sidebar ─────────────────────────────────────────
  function openSidebar()  { sidebar.classList.add("open"); backdrop.classList.add("show"); }
  function closeSidebar() { sidebar.classList.remove("open"); backdrop.classList.remove("show"); }
  menuToggle && menuToggle.addEventListener("click", () => {
    sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });
  backdrop && backdrop.addEventListener("click", closeSidebar);

  // ─── Playground bootstrap ───────────────────────────────────
  let pgMounted = false;
  function mountPlayground() {
    if (pgMounted) return;
    const root = document.getElementById("pg-root");
    if (!root) return;

    // Wait for the bundle to define window.Modra
    let tries = 0;
    const iv = setInterval(() => {
      if (window.Modra && window.ModraPlayground) {
        clearInterval(iv);
        try {
          window.ModraPlayground.mount(root);
          pgMounted = true;
        } catch (err) {
          root.innerHTML = `<div class="pg-pane" style="grid-column:1 / -1; padding:24px; color:var(--danger)">
            Failed to mount the playground: ${(err && err.message) || err}
          </div>`;
        }
      } else if (tries++ > 100) {
        clearInterval(iv);
        root.innerHTML = `<div class="pg-pane" style="grid-column:1 / -1; padding:24px; color:var(--danger)">
          Could not load the Modra compiler bundle (<code>docs/modra-bundle.js</code>).<br/>
          Run <code>npm run docs</code> to rebuild it.
        </div>`;
      }
    }, 60);
  }

  // ─── Comparison tab switcher ────────────────────────────────
  const cmpTabs = $("#cmp-tabs");
  if (cmpTabs) {
    cmpTabs.addEventListener("click", (e) => {
      const btn = e.target.closest(".tab");
      if (!btn) return;
      const key = btn.dataset.cmp;
      cmpTabs.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      $$("[data-cmp-panel]").forEach((p) => p.classList.toggle("active", p.dataset.cmpPanel === key));
    });
  }

  // ─── Syntax highlighting (all code blocks on first paint) ──
  function highlight() {
    if (window.ModraHL && window.ModraHL.highlightAll) {
      window.ModraHL.highlightAll(document);
    }
  }

  // ─── Boot ───────────────────────────────────────────────────
  function boot() {
    highlight();
    showRoute(location.hash || "#/");
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
