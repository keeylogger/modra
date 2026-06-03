/* =============================================================
   Modra Live Playground
   -------------------------------------------------------------
   Lazy-instantiated when the user navigates to #/playground.
   Wires the textarea editor to the bundled Modra compiler and
   updates the right-hand tabs (Tokens / AST / Diagnostics /
   Files / React / Node / SQL) on every keystroke (debounced).
   ============================================================= */

(function () {
  "use strict";

  const EXAMPLES = {
    counter: `// Reactive counter — one component, no boilerplate.
Number: Count <- 0

Action: Increment -> ( Count <- Count + 1 )
Action: Reset     -> ( Count <- 0 )

Component: Counter -> (
  Text: Display <- "Count is " + Count

  form (
    Submit  label: "Increment"  Click -> Increment
    Submit  label: "Reset"      Click -> Reset
  )
)
`,
    todo: `// Tiny todo list — reactive list + an Action that mutates state.
Array<Object>: Items <- []
String: Draft <- ""

Action: Add -> (
  Items <- Items + [Draft]
  Draft <- ""
)

Component: TodoBoard -> (
  Text: Header <- "Items: " + Items.length

  form (
    InputField::Draft  placeholder: "What's next?"
    Submit             label: "Add"  Click -> Add
  )
)
`,
    register: `// Registration: 3-field form on the client, a server endpoint that
// inserts into Postgres. One file. One mental model.

using Backend.Database as DB

Database: Postgres -> (
  Table: Users -> (
    String:  ID @Primary
    String:  Name
    String:  Email @Unique
    String:  PasswordHash
  )
)

Endpoint: Register(name: String, email: String, password: String) -> (
  Record: u <- DB.Users.Insert(
    Name: name,
    Email: email,
    PasswordHash: password,
  )
  Return: u
)

Component: RegistrationForm -> (
  form (
    InputField::Name      placeholder: "Full name"
    InputField::Email     placeholder: "Email"
    InputField::Password  placeholder: "Password"
    Submit                label: "Register"
                          Click -> Register(Name, Email, Password)
  )
)
`,
    fullstack: `// Full-stack: client list, server endpoint, SQL table, and auto-bridge.

using Backend.Database as DB

Database: Postgres -> (
  Table: Products -> (
    String: ID @Primary
    String: Name
    Number: Price
  )
)

Endpoint: LoadProducts -> (
  Array<Object>: rows <- DB.Products.Select()
  Return: rows
)

String: SelectedId <- ""

Action: Buy -> (
  Show: Toast("Thanks for ordering " + SelectedId)
)

Component: Storefront -> (
  Array<Object>: Items <- LoadProducts()
  Text: Header <- "Products"

  form (
    Submit  label: "Buy first item"  Click -> Buy
  )
)
`,
  };

  const TABS = [
    { id: "files",  label: "Files",       desc: "Emitted project" },
    { id: "tokens", label: "Tokens",      desc: "Lexer output" },
    { id: "ast",    label: "AST",         desc: "Parser output" },
    { id: "react",  label: "React",       desc: "Frontend module" },
    { id: "node",   label: "Node",        desc: "Backend module" },
    { id: "sql",    label: "SQL",         desc: "Postgres DDL" },
    { id: "diag",   label: "Diagnostics", desc: "Errors & warnings" },
  ];

  function escape(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === "class") node.className = v;
        else if (k === "style") node.setAttribute("style", v);
        else if (k.startsWith("on")) node.addEventListener(k.slice(2).toLowerCase(), v);
        else if (v === true) node.setAttribute(k, "");
        else if (v === false || v == null) {} 
        else node.setAttribute(k, v);
      }
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      if (typeof c === "string") node.appendChild(document.createTextNode(c));
      else node.appendChild(c);
    }
    return node;
  }

  // ─── Renderers for each output tab ───────────────────────────
  function renderTokens(scanner) {
    try {
      const tokens = scanner.scanAll();
      const Modra = window.Modra;
      const lines = tokens.slice(0, 1500).map((t) => {
        const name = Modra.describeTokenType ? Modra.describeTokenType(t.type) : `t${t.type}`;
        const lex = t.lexeme.replace(/\n/g, "\\n").replace(/\t/g, "\\t");
        return `<span class="tok-keyword">${escape(name.padEnd(14))}</span> <span class="tok-punct">|</span> <span class="tok-string">${escape(lex)}</span>`;
      });
      return lines.join("\n");
    } catch (err) {
      return `<span class="tok-comment">// Failed to tokenize: ${escape(err.message)}</span>`;
    }
  }

  function renderAst(ast) {
    try {
      // Use astToJson if exposed; else JSON.stringify with a span-stripper.
      const Modra = window.Modra;
      let text;
      if (Modra && Modra.astToJson) {
        text = Modra.astToJson(ast, { indent: 2 });
      } else {
        text = JSON.stringify(stripSpans(ast), null, 2);
      }
      return escape(text);
    } catch (err) {
      return `<span class="tok-comment">// Failed to print AST: ${escape(err.message)}</span>`;
    }
  }

  function stripSpans(node, seen = new WeakSet()) {
    if (node === null || node === undefined) return node;
    if (typeof node !== "object") return node;
    if (seen.has(node)) return "[circular]";
    seen.add(node);
    if (Array.isArray(node)) return node.map((c) => stripSpans(c, seen));
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      if (k === "span" || k === "file") continue;
      out[k] = stripSpans(v, seen);
    }
    return out;
  }

  function renderDiagnostics(diagnostics) {
    if (!diagnostics || diagnostics.length === 0) {
      return `<div class="diag-empty">No diagnostics — clean compilation.</div>`;
    }
    return diagnostics.map((d) => {
      const sev = (d.severity || "error").toLowerCase();
      const line = d.span && d.span.start ? d.span.start.line : "?";
      const col  = d.span && d.span.start ? d.span.start.column : "?";
      return `<div class="diag-row ${sev}">
        <div>
          <div class="diag-code">${escape(d.code || sev.toUpperCase())} &middot; line ${line}:${col}</div>
          <div class="diag-msg">${escape(d.message || "")}</div>
        </div>
      </div>`;
    }).join("");
  }

  function renderFiles(files, filterRegex) {
    const matching = files.filter((f) => !filterRegex || filterRegex.test(f.path));
    if (matching.length === 0) {
      return `<div class="diag-empty">Nothing emitted for this target.</div>`;
    }
    return matching.map((f) => {
      const lang = guessLang(f.path);
      const highlighted = window.ModraHL ? window.ModraHL.highlight(f.contents, lang) : escape(f.contents);
      return `<div class="file-block">
        <div class="file-head">${escape(f.path)}</div>
        <pre><code>${highlighted}</code></pre>
      </div>`;
    }).join("");
  }

  function guessLang(path) {
    if (path.endsWith(".ts") || path.endsWith(".tsx")) return "typescript";
    if (path.endsWith(".js") || path.endsWith(".jsx")) return "javascript";
    if (path.endsWith(".json")) return "javascript";
    if (path.endsWith(".sql")) return "sql";
    if (path.endsWith(".md")) return "markdown";
    if (path.endsWith(".html")) return "html";
    return "typescript";
  }

  // ─── Main mount routine ─────────────────────────────────────
  let mounted = false;
  let currentTab = "files";

  function mount(root) {
    if (mounted) return;
    mounted = true;

    // Build the DOM
    const exampleSelect = el("select", { id: "pg-example" },
      ...Object.entries(EXAMPLES).map(([k, _]) =>
        el("option", { value: k }, ({
          counter:   "Counter (basic state)",
          register:  "Registration (full-stack)",
          todo:      "Todo list (lists + loops)",
          fullstack: "Storefront (client + server + db)",
        })[k] || k)
      )
    );

    const editor = el("textarea", {
      id: "pg-editor",
      spellcheck: "false",
      autocorrect: "off",
      autocapitalize: "off",
    });

    const editorPane = el("div", { class: "pg-pane" },
      el("div", { class: "pg-head" },
        el("h4", null, "Modra source"),
        el("div", null,
          el("span", { class: "pill primary", style: "margin-right:8px" }, "v1.0.0"),
          exampleSelect,
        ),
      ),
      el("div", { class: "pg-body" },
        el("div", { class: "editor" }, editor),
      ),
    );

    const tabsBar = el("div", { class: "pg-tabs", id: "pg-tabs" },
      ...TABS.map((t) => el("button", {
        class: "pg-tab" + (t.id === currentTab ? " active" : ""),
        "data-tab": t.id,
        title: t.desc,
      }, t.label))
    );

    const result = el("div", { class: "pg-result wrap", id: "pg-result" }, "Compiling…");

    const outputPane = el("div", { class: "pg-pane" },
      el("div", { class: "pg-head" },
        el("h4", null, "Compiler output"),
        el("div", { id: "pg-status", style: "font-size:11px;color:var(--text-faint)" }, ""),
      ),
      tabsBar,
      result,
    );

    root.innerHTML = "";
    root.appendChild(editorPane);
    root.appendChild(outputPane);

    // Wire interactions
    function setTab(id) {
      currentTab = id;
      tabsBar.querySelectorAll(".pg-tab").forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === id);
      });
      recompile();
    }
    tabsBar.addEventListener("click", (e) => {
      const btn = e.target.closest(".pg-tab");
      if (btn) setTab(btn.dataset.tab);
    });

    exampleSelect.addEventListener("change", () => {
      editor.value = EXAMPLES[exampleSelect.value];
      recompile();
    });

    editor.addEventListener("keydown", (e) => {
      // Tab inserts two spaces.
      if (e.key === "Tab") {
        e.preventDefault();
        const s = editor.selectionStart, en = editor.selectionEnd;
        editor.value = editor.value.slice(0, s) + "  " + editor.value.slice(en);
        editor.selectionStart = editor.selectionEnd = s + 2;
        recompile();
      }
    });

    const debouncedCompile = debounce(() => recompile(), 180);
    editor.addEventListener("input", debouncedCompile);

    // Seed with first example.
    editor.value = EXAMPLES.counter;

    function recompile() {
      const Modra = window.Modra;
      const status = document.getElementById("pg-status");
      const r = document.getElementById("pg-result");
      if (!Modra) {
        r.classList.remove("wrap");
        r.innerHTML = `<div class="diag-empty">The Modra compiler bundle hasn't loaded yet. Refresh the page or check the console.</div>`;
        return;
      }
      const src = editor.value;
      try {
        const t0 = performance.now();
        const scanner = new Modra.Scanner(src, "playground.modra");
        const parseResult = Modra.parse(src, "playground.modra");
        let analysis = null;
        let emission = null;
        let analysisErr = null;
        let emitErr = null;
        try {
          analysis = Modra.analyze(parseResult.ast, "playground.modra");
        } catch (e) { analysisErr = e; }
        if (analysis && !analysis.hasErrors) {
          try { emission = Modra.emitProject(analysis); }
          catch (e) { emitErr = e; }
        }
        const ms = (performance.now() - t0).toFixed(1);

        const diags = [
          ...(parseResult.diagnostics || []),
          ...((analysis && analysis.diagnostics) || []),
        ];
        const errCount = diags.filter((d) => (d.severity || "error") === "error").length;
        status.textContent =
          (errCount ? `${errCount} error${errCount === 1 ? "" : "s"} · ` : "✓ Clean · ") + `${ms} ms`;
        status.style.color = errCount ? "var(--danger)" : "var(--success)";

        r.classList.remove("wrap");

        switch (currentTab) {
          case "tokens":
            r.classList.add("wrap");
            r.innerHTML = renderTokens(new Modra.Scanner(src, "playground.modra"));
            break;
          case "ast":
            r.innerHTML = `<pre><code>${renderAst(parseResult.ast)}</code></pre>`;
            break;
          case "diag":
            r.classList.add("wrap");
            r.innerHTML = `<div class="diag-list">${renderDiagnostics(diags)}</div>`;
            break;
          case "react":
            r.innerHTML = emission
              ? renderFiles(emission.files, /^src\/(?!.*main\.tsx).*\.(tsx|ts|css)$/)
              : `<div class="diag-empty">Fix the diagnostics above to see emitted React.</div>`;
            break;
          case "node":
            r.innerHTML = emission
              ? renderFiles(emission.files, /^server\//)
              : `<div class="diag-empty">Fix the diagnostics above to see emitted Node.</div>`;
            break;
          case "sql":
            r.innerHTML = emission
              ? renderFiles(emission.files, /\.sql$/)
              : `<div class="diag-empty">No SQL emitted (no Database declaration?).</div>`;
            break;
          case "files":
          default:
            r.innerHTML = emission
              ? renderFiles(emission.files)
              : analysisErr
              ? `<div class="diag-empty">Analyzer crashed: ${escape(analysisErr.message)}</div>`
              : emitErr
              ? `<div class="diag-empty">Emitter crashed: ${escape(emitErr.message)}</div>`
              : `<div class="diag-empty">Fix the diagnostics above to see the emitted project.</div>`;
            break;
        }
      } catch (err) {
        status.textContent = "✗ Crash";
        status.style.color = "var(--danger)";
        r.classList.add("wrap");
        r.innerHTML = `<div class="diag-empty" style="color:var(--danger)">${escape(err && err.stack ? err.stack : String(err))}</div>`;
      }
    }

    recompile();
  }

  window.ModraPlayground = { mount };
})();
