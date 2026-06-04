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
  const content = $("#content");
  const html = document.documentElement;

  // Routes that benefit from a wider content column (overrides the
  // default ~980px reading width set by `.content`).
  const WIDE_ROUTES = new Set(["#/playground", "#/examples"]);

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

    if (content) {
      content.classList.toggle("content--wide", WIDE_ROUTES.has(active.dataset.route));
    }

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

  function pgPaneStatus(message, isError) {
    return `<div class="pg-pane" style="grid-column:1 / -1; padding:24px; text-align:center; color:${
      isError ? "var(--danger)" : "var(--text-dim)"
    }">${message}</div>`;
  }

  function mountPlayground() {
    if (pgMounted) return;
    const root = document.getElementById("pg-root");
    if (!root) return;

    root.innerHTML = pgPaneStatus(
      `<p style="margin:0 0 6px 0;font-weight:600">Loading the Modra compiler…</p>
       <p style="margin:0;font-size:12px;color:var(--text-faint)">This usually takes under a second.</p>`,
      false,
    );

    let tries = 0;
    const MAX_TRIES = 200; // 200 × 60ms = 12s of patience
    const iv = setInterval(() => {
      tries++;
      const hasModra = !!window.Modra;
      const hasPg = !!window.ModraPlayground;

      if (hasModra && hasPg) {
        clearInterval(iv);
        try {
          window.ModraPlayground.mount(root);
          pgMounted = true;
        } catch (err) {
          console.error("[Modra playground] mount failed:", err);
          root.innerHTML = pgPaneStatus(
            `<p style="margin:0 0 6px 0;font-weight:600">Could not mount the playground.</p>
             <p style="margin:0;font-size:12px">${(err && err.message) || err}</p>
             <p style="margin:8px 0 0 0;font-size:11px;color:var(--text-faint)">Open the browser console for the full stack trace.</p>`,
            true,
          );
        }
        return;
      }

      if (tries > MAX_TRIES) {
        clearInterval(iv);
        const missing = [
          hasModra ? null : "<code>window.Modra</code> (from <code>docs/modra-bundle.js</code>)",
          hasPg    ? null : "<code>window.ModraPlayground</code> (from <code>docs/playground.js</code>)",
        ].filter(Boolean).join(" and ");
        console.error("[Modra playground] timed out waiting for", missing);
        root.innerHTML = pgPaneStatus(
          `<p style="margin:0 0 6px 0;font-weight:600">Could not load the playground.</p>
           <p style="margin:0;font-size:12px">Missing ${missing}.</p>
           <p style="margin:8px 0 0 0;font-size:11px;color:var(--text-faint)">
             Try a hard refresh (<span class="kbd">Ctrl</span>+<span class="kbd">Shift</span>+<span class="kbd">R</span>)
             or open the browser console for details.
           </p>`,
          true,
        );
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
