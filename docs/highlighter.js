/* =============================================================
   Modra syntax highlighter — uses the bundled Modra lexer when
   available (window.Modra), and falls back to a regex tokenizer
   so docs render even if the bundle is missing.
   ============================================================= */

(function () {
  "use strict";

  const KEYWORDS = new Set([
    // PascalCase declaration keywords
    "Component", "Action", "Endpoint", "Database", "Table", "Style", "Type",
    "Using", "Native", "Server", "Client", "Else", "Match", "When", "Return",
    "Yield", "If", "For", "While", "Break", "Continue", "True", "False", "None",
    // lowercase modifiers
    "using", "primary", "key", "indexed", "unique", "as", "in", "of", "to",
    "from", "by", "and", "or", "not", "import", "export",
  ]);

  // Built-in primitive / common types we want coloured.
  const TYPES = new Set([
    "Number", "String", "Bool", "Color", "DateTime", "Array", "Map",
    "Option", "Record", "Error", "Any", "None", "UUID", "URL",
  ]);

  const OPERATORS = [
    "<->", "<-", "->", "<:", "::", "==", "!=", "<=", ">=", "&&", "||",
    "..", "=>", "?.", "?",
    "+", "-", "*", "/", "%", "<", ">", "=", "!", "&", "|", "@",
  ];

  // Sort by length so the longest matches first.
  OPERATORS.sort((a, b) => b.length - a.length);

  function escape(s) {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ─── Regex-based fallback tokenizer ──────────────────────────
  function fallbackHighlight(src) {
    let i = 0;
    const out = [];
    const len = src.length;

    while (i < len) {
      const c = src[i];

      // Line comment
      if (c === "/" && src[i + 1] === "/") {
        let j = i;
        while (j < len && src[j] !== "\n") j++;
        out.push(`<span class="tok-comment">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Block comment
      if (c === "/" && src[i + 1] === "*") {
        let j = i + 2;
        while (j < len && !(src[j] === "*" && src[j + 1] === "/")) j++;
        if (j < len) j += 2;
        out.push(`<span class="tok-comment">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Strings (double-quoted, with simple escapes)
      if (c === '"') {
        let j = i + 1;
        while (j < len && src[j] !== '"') {
          if (src[j] === "\\" && j + 1 < len) j += 2;
          else j++;
        }
        if (j < len) j++;
        out.push(`<span class="tok-string">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Hex colors
      if (c === "#" && /[0-9a-fA-F]/.test(src[i + 1] || "")) {
        let j = i + 1;
        while (j < len && /[0-9a-fA-F]/.test(src[j])) j++;
        out.push(`<span class="tok-number">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(c)) {
        let j = i;
        while (j < len && /[0-9_]/.test(src[j])) j++;
        if (src[j] === ".") {
          j++;
          while (j < len && /[0-9_]/.test(src[j])) j++;
        }
        out.push(`<span class="tok-number">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Directives (@@target, @{...}, decorators)
      if (c === "@") {
        let j = i + 1;
        if (src[j] === "@") {
          while (j < len && /[A-Za-z_]/.test(src[j])) j++;
        } else {
          while (j < len && /[A-Za-z_]/.test(src[j])) j++;
        }
        out.push(`<span class="tok-directive">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Identifiers / keywords / types
      if (/[A-Za-z_]/.test(c)) {
        let j = i;
        while (j < len && /[A-Za-z0-9_]/.test(src[j])) j++;
        const word = src.slice(i, j);
        let cls = "tok-ident";
        if (KEYWORDS.has(word)) cls = "tok-keyword";
        else if (TYPES.has(word)) cls = "tok-type";
        else if (/^[A-Z]/.test(word) && /[a-z]/.test(word.slice(1))) {
          // PascalCase but unknown → treat as type-ish
          cls = "tok-type";
        }
        out.push(`<span class="${cls}">${escape(word)}</span>`);
        i = j;
        continue;
      }

      // Operators
      let matched = false;
      for (const op of OPERATORS) {
        if (src.startsWith(op, i)) {
          out.push(`<span class="tok-op">${escape(op)}</span>`);
          i += op.length;
          matched = true;
          break;
        }
      }
      if (matched) continue;

      // Punctuation
      if (/[(),{}\[\];:.]/.test(c)) {
        out.push(`<span class="tok-punct">${escape(c)}</span>`);
        i++;
        continue;
      }

      // Whitespace / anything else
      out.push(escape(c));
      i++;
    }

    return out.join("");
  }

  // ─── Generic highlighters for comparison code blocks ─────────
  // These don't have to be perfect — they just need to look nice.
  const LANG_RULES = {
    javascript: {
      kw: /^(const|let|var|function|return|if|else|for|while|class|new|async|await|import|export|from|of|in|do|switch|case|break|continue|true|false|null|undefined|this|typeof|extends|default)\b/,
      type: /^(string|number|boolean|object|any|void|Promise|Array|Map|Set|Date)\b/,
      builtin: /^(console|document|window|Math|JSON|Object|Array|String|Number|Boolean|process|Error)\b/,
    },
    typescript: {
      kw: /^(const|let|var|function|return|if|else|for|while|class|new|async|await|import|export|from|of|in|do|switch|case|break|continue|true|false|null|undefined|this|typeof|extends|default|interface|type|enum|readonly|public|private|protected|implements|abstract|namespace)\b/,
      type: /^(string|number|boolean|object|any|void|Promise|Array|Map|Set|Date|never|unknown)\b/,
      builtin: /^(console|document|window|Math|JSON|Object|Array|String|Number|Boolean|process|Error)\b/,
    },
    python: {
      kw: /^(def|class|return|if|elif|else|for|while|in|is|not|and|or|None|True|False|import|from|as|with|try|except|finally|raise|yield|lambda|pass|break|continue|global|nonlocal|async|await)\b/,
      type: /^(int|str|float|bool|list|dict|set|tuple|None|object|Any|Optional|List|Dict)\b/,
      builtin: /^(print|len|range|enumerate|map|filter|input|open|isinstance|type|str|int|float|list|dict|tuple|set)\b/,
    },
    java: {
      kw: /^(public|private|protected|class|interface|extends|implements|abstract|final|static|void|return|if|else|for|while|do|switch|case|break|continue|new|this|super|import|package|throws|try|catch|finally|throw|null|true|false|var|record|sealed)\b/,
      type: /^(int|long|short|byte|float|double|boolean|char|String|Integer|Long|List|Map|Set|Object|Exception)\b/,
      builtin: /^(System|out|println|println|Math|Collections|Arrays|Stream)\b/,
    },
    go: {
      kw: /^(func|var|const|type|struct|interface|return|if|else|for|range|switch|case|break|continue|defer|go|select|map|chan|package|import|nil|true|false)\b/,
      type: /^(int|int8|int16|int32|int64|uint|uint8|uint16|uint32|uint64|float32|float64|string|bool|byte|rune|error|any)\b/,
      builtin: /^(fmt|len|cap|make|new|append|copy|delete|panic|recover|print|println)\b/,
    },
    csharp: {
      kw: /^(public|private|protected|internal|class|interface|struct|record|enum|void|return|if|else|for|foreach|while|do|switch|case|break|continue|new|this|base|using|namespace|throw|try|catch|finally|null|true|false|var|async|await|in|out|ref|readonly|static|sealed|abstract|virtual|override)\b/,
      type: /^(int|long|short|byte|float|double|decimal|bool|char|string|object|Task|List|Dictionary|HashSet|Action|Func)\b/,
      builtin: /^(Console|WriteLine|Math|String|Int32|DateTime|System)\b/,
    },
    sql: {
      kw: /^(SELECT|FROM|WHERE|INSERT|UPDATE|DELETE|CREATE|TABLE|INDEX|PRIMARY|KEY|UNIQUE|NOT|NULL|JOIN|ON|GROUP|BY|ORDER|HAVING|AS|AND|OR|IN|IS|LIMIT|VALUES|INTO|SET|DROP|ALTER|ADD)\b/i,
      type: /^(INTEGER|VARCHAR|TEXT|BOOLEAN|TIMESTAMP|UUID|JSONB|SERIAL|DATE|TIME|NUMERIC|REAL)\b/i,
      builtin: /^(NOW|COUNT|SUM|AVG|MIN|MAX|COALESCE|LOWER|UPPER)\b/i,
    },
    bash: {
      kw: /^(if|then|fi|else|elif|do|done|for|while|in|case|esac|function|return|exit|export|local|readonly)\b/,
      type: /^$/,
      builtin: /^(echo|cd|ls|pwd|mkdir|rm|cp|mv|cat|grep|sed|awk|npm|node|modra|git)\b/,
    },
  };
  LANG_RULES.js = LANG_RULES.javascript;
  LANG_RULES.ts = LANG_RULES.typescript;
  LANG_RULES.py = LANG_RULES.python;
  LANG_RULES.sh = LANG_RULES.bash;
  LANG_RULES.shell = LANG_RULES.bash;
  LANG_RULES["c#"] = LANG_RULES.csharp;
  LANG_RULES.cs = LANG_RULES.csharp;
  LANG_RULES.golang = LANG_RULES.go;
  LANG_RULES.tsx = LANG_RULES.typescript;
  LANG_RULES.jsx = LANG_RULES.javascript;

  function highlightGeneric(src, lang) {
    const rules = LANG_RULES[lang];
    if (!rules) return escape(src);

    let i = 0;
    const out = [];
    const len = src.length;

    while (i < len) {
      const rest = src.slice(i);

      // Line comments
      if (rest.startsWith("//") || (lang === "python" && rest.startsWith("#")) || (lang === "bash" && rest.startsWith("#")) || (lang === "sql" && rest.startsWith("--"))) {
        let j = i;
        while (j < len && src[j] !== "\n") j++;
        out.push(`<span class="tok-comment">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }
      if (rest.startsWith("/*")) {
        let j = i + 2;
        while (j < len && !(src[j] === "*" && src[j + 1] === "/")) j++;
        if (j < len) j += 2;
        out.push(`<span class="tok-comment">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Strings: " ' `
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") {
        let j = i + 1;
        while (j < len && src[j] !== c) {
          if (src[j] === "\\" && j + 1 < len) j += 2;
          else j++;
        }
        if (j < len) j++;
        out.push(`<span class="tok-string">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Numbers
      if (/[0-9]/.test(c)) {
        let j = i;
        while (j < len && /[0-9_a-fxA-FX.]/.test(src[j])) j++;
        out.push(`<span class="tok-number">${escape(src.slice(i, j))}</span>`);
        i = j;
        continue;
      }

      // Identifiers / keywords
      if (/[A-Za-z_$]/.test(c)) {
        let j = i;
        while (j < len && /[A-Za-z0-9_$]/.test(src[j])) j++;
        const word = src.slice(i, j);
        let cls = "tok-ident";
        if (rules.kw.test(word)) cls = "tok-keyword";
        else if (rules.type.test(word)) cls = "tok-type";
        else if (rules.builtin.test(word)) cls = "tok-builtin";
        else if (/^[A-Z]/.test(word)) cls = "tok-type";
        out.push(`<span class="${cls}">${escape(word)}</span>`);
        i = j;
        continue;
      }

      // Punctuation / operators
      if (/[(){}\[\];,.:]/.test(c)) {
        out.push(`<span class="tok-punct">${escape(c)}</span>`);
        i++;
        continue;
      }
      if (/[+\-*/%=<>!&|^~?]/.test(c)) {
        out.push(`<span class="tok-op">${escape(c)}</span>`);
        i++;
        continue;
      }

      out.push(escape(c));
      i++;
    }

    return out.join("");
  }

  // ─── Public API ──────────────────────────────────────────────
  function highlight(src, lang) {
    if (!lang || lang === "modra") return fallbackHighlight(src);
    return highlightGeneric(src, lang.toLowerCase());
  }

  function highlightAll(root) {
    const scope = root || document;
    const blocks = scope.querySelectorAll("pre code, pre[data-lang]");
    blocks.forEach((el) => {
      if (el.dataset.highlighted === "1") return;
      const lang = (el.dataset.lang || el.className.replace(/^language-/, "") || "modra").toLowerCase();
      const src = el.textContent;
      el.innerHTML = highlight(src, lang);
      el.dataset.highlighted = "1";
    });
  }

  window.ModraHL = { highlight, highlightAll };
})();
