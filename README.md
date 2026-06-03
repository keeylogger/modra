<div align="center">

<img src="./assets/png/logo-256.png" alt="Modra logo" width="160" height="160" />

# Modra

### *One file. UI, state, server, and database — compiled to a full-stack app.*

[![version](https://img.shields.io/badge/version-1.0.0-2E9D43?style=flat-square)](#)
[![status](https://img.shields.io/badge/status-alpha-7BD389?style=flat-square)](#)
[![license](https://img.shields.io/badge/license-MIT-E63946?style=flat-square)](#license)
[![node](https://img.shields.io/badge/node-%E2%89%A520-155E2B?style=flat-square)](#)
[![tests](https://img.shields.io/badge/tests-294%20passing-2E9D43?style=flat-square)](#)

[📖 Docs](https://keeylogger.github.io/modra/) · [▶ Live playground](https://keeylogger.github.io/modra/README.html#/playground) · [🚀 Quick start](#-quick-start) · [🆚 Comparisons](#-modra-vs-the-world) · [🧪 Examples](#-examples)

</div>

---

## ✨ What is Modra?

Modra is a **declarative full-stack language**. You write one `.modra` file, and the
compiler emits a complete project tree:

- 🎨 a **React + TypeScript** frontend (Vite-powered)
- 🛠️ a **Node + Express** backend
- 🗄️ a **Postgres** schema (DDL + typed query API)
- 🌉 the **fetch bridge** + typed RPC between client and server
- 🐍 **native escape hatches** for Python / TypeScript / Go / Rust

No glue code. No ORM. No API client. No drift.

```modra
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
```

> That single file compiles to a runnable React app with `useState`, controlled forms,
> typed handlers, and zero hand-written ceremony.

---

## 🧭 Table of contents

- [✨ Why](#-why-modra-exists)
- [🚀 Quick start](#-quick-start)
- [🎯 Core ideas](#-core-ideas)
- [📚 Language tour](#-language-tour)
  - [The four assignment operators](#the-four-assignment-operators)
  - [State, components, and forms](#state-components-and-forms)
  - [Actions](#actions)
  - [Endpoints & the auto-bridge](#endpoints--the-auto-bridge)
  - [Databases](#databases)
  - [Native bridges](#native-bridges)
- [🆚 Modra vs the world](#-modra-vs-the-world)
- [🛠️ CLI](#-cli)
- [🧪 Examples](#-examples)
- [🩺 Diagnostics](#-diagnostics)
- [🗺️ Roadmap](#-roadmap)
- [🤝 Contributing](#-contributing)
- [📄 License](#license)

---

## ✨ Why Modra exists

Modern web stacks scatter **one feature** across five files: a React component, a hook,
an API route handler, a database migration, and a hand-written typed client.
They drift. They duplicate. Modra collapses them.

| Concern           | Typical stack                   | Modra                      |
| ----------------- | ------------------------------- | -------------------------- |
| UI markup         | JSX / Svelte / Vue template     | `form ( … )` element tree  |
| UI state          | `useState`, signals, stores     | `Number: X <- 0`           |
| Server endpoint   | Express route + Zod schema      | `Endpoint: X -> ( … )`     |
| Client call       | Hand-written fetch + types      | Just call the endpoint     |
| Database schema   | SQL file or ORM model           | `Table: T -> ( … )`        |
| Validation        | Zod / Yup / Joi                 | Types are the schema       |
| Routing glue      | Express + react-router + types  | All emitted automatically  |

---

## 🚀 Quick start

```bash
# 1 · install
npm install -g modra

# 2 · scaffold
modra init taskboard
cd taskboard

# 3 · build → full project tree
modra build taskboard.modra -o ./dist

# 4 · run
cd dist
npm install
npm run dev     # client on :5173, server on :3000
```

> 💡 Use `modra dev <src> -o ./dist` to watch the source file and rebuild on save.

The build emits:

```
dist/
├── package.json         # Vite + React + Express setup
├── vite.config.ts
├── tsconfig.json
├── .env.example
├── README.md
├── src/                 # React frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/…
│   └── runtime/         # client stdlib (Toast, Navigate, Date, Hash, …)
├── server/              # Node + Express backend
│   ├── index.ts
│   ├── db.ts
│   ├── routes/
│   └── runtime/         # server stdlib (AuthToken, Hash, HTTP, …)
├── shared/              # auto-generated bridge
│   ├── rpc.ts
│   └── types.ts
└── schema.sql           # Postgres DDL
```

---

## 🎯 Core ideas

| Idea                          | What it gives you                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------- |
| 🧠 **One mental model**       | UI, state, server, SQL — same syntax, same scoping, same operators.               |
| ⚡ **Reactive by default**     | `<-` binds reactively; reads stay in sync with writes.                            |
| 🌉 **Auto-bridged**           | Call a server `Endpoint` like a local function; the fetch + types are generated.  |
| 🗃️ **Database, first-class** | `Database: Postgres -> ( Table: … )` → DDL + typed query API for free.            |
| 🎨 **Plain UI attributes**    | `InputField::Email placeholder: "…"` — no className/style strings.                |
| 🚪 **Native escape hatches**  | `Native<Python>(in: x; out: y) { … }` — drop into TS / Python / Go / Rust.        |
| 🩺 **Pretty diagnostics**     | Rust-style errors with source carets and stable codes (`MOD-S002` etc.).          |
| 🪶 **Tiny compiler**           | Hand-written lexer + parser + analyzer + emitter. ~6 ms per file.                  |

---

## 📚 Language tour

### The four assignment operators

| Op       | Reads as              | Meaning                                                |
| -------- | --------------------- | ------------------------------------------------------ |
| `:`      | *"is"*                | Static declaration / label                             |
| `<-`     | *"reactively becomes"* | Reactive binding — re-runs when dependencies change    |
| `->`     | *"then"*              | Event handler / endpoint body                          |
| `<->`    | *"is synced with"*    | Two-way binding                                        |
| `<:`     | *"apply effect"*      | Attach a declarative effect to a value                 |

```modra
// Static literal — value never changes after init.
String: AppName <- "Modra"

// Reactive — re-runs whenever Count changes.
Number: Count <- 0
String: Label <- "Count is " + Count

Action: Tap -> ( Count <- Count + 1 )
```

### State, components, and forms

State lives at the top of a `Component`. Two-way bindings auto-declare state for you.

```modra
Component: Profile -> (
  String: Name <- "Ada"
  Number: Age  <- 36
  String: Bio  <- Name + " is " + Age + " years old."

  form (
    InputField::Name
    InputField::Age
    Text: BioLine (Bio)
  )
)
```

Or, skip the state declarations — `InputField::Email` will create one for you:

```modra
Component: Login -> (
  form (
    InputField::Email      // auto-declares String: Email <- ""
    InputField::Password   // auto-declares String: Password <- ""
    Submit  label: "Sign in"  Click -> Authenticate(Email, Password)
  )
)
```

### Actions

`Action`s are reusable behaviour. They run on the client by default.

```modra
Number: Count <- 0

Action: Increment(by: Number) -> (
  Count <- Count + by
)

Component: Counter -> (
  Text: Display <- "Count: " + Count

  form (
    Submit  label: "+1"   Click -> Increment(1)
    Submit  label: "+10"  Click -> Increment(10)
  )
)
```

### Endpoints & the auto-bridge

`Endpoint`s run on the server. The compiler generates the route, the request/response
types, *and* the client fetch wrapper. You call them like local functions.

```modra
String: Reply <- ""

Endpoint: Greet(name: String) -> (
  Return: "Hello, " + name
)

Action: SayHi -> (
  // Looks local; compiled to a fetch.
  Reply <- Greet(Name)
)

Component: Hello -> (
  form (
    InputField::Name
    Submit  label: "Say hi"  Click -> SayHi
    Text: Out (Reply)
  )
)
```

### Databases

A `Database` block becomes Postgres DDL **plus** a typed query API on the server.

```modra
using Backend.Database as DB

Database: Postgres -> (
  Table: Users -> (
    String:   ID @Primary
    String:   Email @Unique
    String:   PasswordHash
    String:   Role
    DateTime: CreatedAt <- Now()
  )

  Table: Posts -> (
    String: ID @Primary
    String: Title @Indexed
    String: Body
    String: AuthorID @References(Users.ID)
  )
)

Endpoint: Register(email: String, password: String) -> (
  Record: u <- DB.Users.Insert(
    ID:           UUID(),
    Email:        email,
    PasswordHash: Hash(password),
    Role:         "user",
  )
  Return: u.ID
)
```

Column decorators:

| Decorator              | SQL                                  |
| ---------------------- | ------------------------------------ |
| `@Primary`             | `PRIMARY KEY`                        |
| `@Unique`              | `UNIQUE`                             |
| `@Indexed`             | `CREATE INDEX`                       |
| `@References(T.col)`   | `REFERENCES T(col)`                  |
| `@Nullable`            | column allows NULL                   |
| `<- value`             | `DEFAULT value`                      |

### Native bridges

When Modra can't express it, drop into a typed native block.

```modra
Endpoint: Sentiment(text: String) -> (
  String: label
  Native<Python>(in: text; out: label) {
    from transformers import pipeline
    clf = pipeline("sentiment-analysis")
    label = clf(text)[0]["label"]
  }
  Return: label
)
```

| Target       | Adapter                  | Status              |
| ------------ | ------------------------ | ------------------- |
| `TypeScript` | inlined in Node bundle   | ✅ stable           |
| `Python`     | `python -m natives.<N>`  | ✅ stable           |
| `Go`         | HTTP sidecar             | 🧪 experimental    |
| `Rust`       | WASM module              | 🧪 experimental    |

---

## 🆚 Modra vs the world

The same reactive counter, six ways:

<details>
<summary><b>⚡ Modra · 12 lines · 1 file</b></summary>

```modra
Number: Count <- 0

Action: Increment -> ( Count <- Count + 1 )
Action: Reset     -> ( Count <- 0 )

Component: Counter -> (
  Text: Display <- "Count is " + Count

  form (
    Submit  label: "+"      Click -> Increment
    Submit  label: "Reset"  Click -> Reset
  )
)
```

</details>

<details>
<summary><b>⚛️ JavaScript (React) · ~18 lines · 1 file</b></summary>

```javascript
import { useState } from "react";

export default function Counter() {
  const [count, setCount] = useState(0);
  return (
    <form>
      <h1>Count is {count}</h1>
      <button type="button" onClick={() => setCount(count + 1)}>+</button>
      <button type="button" onClick={() => setCount(0)}>Reset</button>
    </form>
  );
}
```

</details>

<details>
<summary><b>🐍 Python (Flask + HTMX) · ~30 lines · 2 files</b></summary>

```python
# app.py
from flask import Flask, render_template, redirect

app = Flask(__name__)
state = {"count": 0}

@app.route("/")
def index():
    return render_template("counter.html", count=state["count"])

@app.route("/inc", methods=["POST"])
def inc():
    state["count"] += 1
    return redirect("/")

@app.route("/reset", methods=["POST"])
def reset():
    state["count"] = 0
    return redirect("/")
```

```html
<!-- templates/counter.html -->
<form>
  <h1>Count is {{ count }}</h1>
  <button hx-post="/inc">+</button>
  <button hx-post="/reset">Reset</button>
</form>
```

</details>

<details>
<summary><b>☕ Java (Spring + Thymeleaf) · ~25 lines · 2 files</b></summary>

```java
@Controller
public class CounterController {
  private int count = 0;

  @GetMapping("/")
  public String index(Model model) {
    model.addAttribute("count", count);
    return "counter";
  }

  @PostMapping("/inc")
  public String inc() { count++; return "redirect:/"; }

  @PostMapping("/reset")
  public String reset() { count = 0; return "redirect:/"; }
}
```

</details>

<details>
<summary><b>🐹 Go (net/http + html/template) · ~30 lines</b></summary>

```go
package main

import (
  "html/template"
  "net/http"
  "sync"
)

var (
  mu    sync.Mutex
  count int
  tpl   = template.Must(template.New("c").Parse(`
<form>
  <h1>Count is {{.}}</h1>
  <button formaction="/inc" formmethod="post">+</button>
  <button formaction="/reset" formmethod="post">Reset</button>
</form>`))
)

func main() {
  http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
    mu.Lock(); defer mu.Unlock(); tpl.Execute(w, count)
  })
  http.HandleFunc("/inc",   func(w http.ResponseWriter, r *http.Request) { mu.Lock(); count++; mu.Unlock(); http.Redirect(w, r, "/", 302) })
  http.HandleFunc("/reset", func(w http.ResponseWriter, r *http.Request) { mu.Lock(); count = 0; mu.Unlock(); http.Redirect(w, r, "/", 302) })
  http.ListenAndServe(":8080", nil)
}
```

</details>

<details>
<summary><b>🟦 C# (ASP.NET Razor Pages) · ~20 lines · 2 files</b></summary>

```csharp
public class IndexModel : PageModel {
  public static int Count = 0;
  public void OnGet() { }
  public IActionResult OnPostInc()   { Count++;    return RedirectToPage(); }
  public IActionResult OnPostReset() { Count = 0;  return RedirectToPage(); }
}
```

```cshtml
@page
@model IndexModel
<form method="post">
  <h1>Count is @IndexModel.Count</h1>
  <button asp-page-handler="Inc">+</button>
  <button asp-page-handler="Reset">Reset</button>
</form>
```

</details>

### Concept map

| Modra                       | JS / React            | Python (Flask)        | Java (Spring)         | Go                       | C# (.NET)          |
| --------------------------- | --------------------- | --------------------- | --------------------- | ------------------------ | ------------------ |
| `Component: X -> ( … )`     | `function Comp()`     | `render_template`     | `@Controller`         | `html/template`          | Razor Page         |
| `Number: X <- 0`            | `useState(0)`         | session / global      | bean field            | `var` + `sync.Mutex`     | property           |
| `Action: X -> ( … )`        | regular function      | regular function      | service method        | regular function         | method             |
| `Endpoint: X -> ( … )`      | Express route         | `@app.route`          | `@PostMapping`        | `http.HandleFunc`        | `OnPost…`          |
| `Database: T -> ( Table )`  | Prisma schema         | SQLAlchemy model      | JPA entity            | raw SQL + struct         | EF `DbSet<T>`      |
| `@@target: Server`          | folder convention     | folder convention     | annotation            | folder convention        | folder convention  |
| `Native<Python>(…)`         | `child_process`       | —                     | `ProcessBuilder`      | `exec.Command`           | `Process.Start`    |

---

## 🛠️ CLI

| Command                            | What it does                                                  |
| ---------------------------------- | ------------------------------------------------------------- |
| `modra init <name>`                | Scaffold a new project folder with a starter `.modra` file    |
| `modra build <src> -o <dir>`       | Emit the full Vite + Express + Postgres project               |
| `modra dev <src> -o <dir>`         | Watch source and rebuild on save                              |
| `modra check <src>`                | Type-check and report diagnostics — no emit                   |
| `modra parse <src>`                | Print the AST as JSON                                         |
| `modra lex <src>`                  | Print the token stream                                        |

```bash
modra init shop && cd shop
modra build shop.modra -o dist
cd dist && npm install && npm run dev
```

---

## 🧪 Examples

Try each in the [live playground](https://keeylogger.github.io/modra/README.html#/playground).

| Example                | What it shows                                                |
| ---------------------- | ------------------------------------------------------------ |
| **Counter**            | Reactive state, Actions, controlled buttons                  |
| **Todo list**          | List state, mutation, computed values                        |
| **Registration**       | Client form + server `Endpoint` + Postgres `Table`           |
| **Search-as-you-type** | Reactive list, debouncing pattern, server call from client   |
| **Storefront**         | Loop rendering, cart state, multiple endpoints, DDL          |

Each example also lives in the [online docs](https://keeylogger.github.io/modra/README.html#/examples). The
playground recompiles them in your browser on every keystroke.

---

## 🩺 Diagnostics

Modra emits Rust-style errors with source carets, stable codes, and helpful hints.

```text
error[MOD-S002]: Cannot find name 'Custmer'
  ┌─ src/app.modra:14:23
14 │   Array<Customer>: Custmer <- DB.Users.All()
   │                       ^^^^^^^ help: did you mean 'Customer'?
```

| Prefix       | Phase                        |
| ------------ | ---------------------------- |
| `MOD-L###`   | Lexer                        |
| `MOD-P###`   | Parser                       |
| `MOD-S###`   | Semantic analysis            |
| `MOD-E###`   | Emitter                      |

---

## 🗺️ Roadmap

| Phase                          | Status                                                  |
| ------------------------------ | ------------------------------------------------------- |
| **1 · Lexer**                  | ✅ shipped                                              |
| **2 · Parser + AST**           | ✅ shipped                                              |
| **3 · Semantic analysis**      | ✅ shipped                                              |
| **4 · Emitters (React/Node/PG)** | ✅ shipped                                            |
| **5 · Standard library**       | ✅ shipped                                              |
| **6 · Pretty diagnostics**     | ✅ shipped                                              |
| **7 · CLI + dev server**       | ✅ shipped                                              |
| 1.1 · Formatter (`modra fmt`)  | 🛣️ planned                                            |
| 1.1 · LSP server               | 🛣️ planned                                            |
| 1.1 · Migration diff (`build --diff`) | 🛣️ planned                                     |
| 1.2 · React Native target      | 💭 considering                                          |
| 1.2 · Single-component emit    | 💭 considering                                          |

---

## 🤝 Contributing

Modra is a single-author alpha right now, but PRs and issues are welcome.

```bash
git clone https://github.com/keeylogger/modra
cd modra
npm install
npm test       # 294 tests
npm run docs   # rebuild docs/modra-bundle.js
```

Areas where help is especially appreciated:

- 🐛 Edge cases in the parser (the grammar is intentionally loose; bug reports help tighten it)
- 🎨 More UI primitives + the `Style` design-token system
- 🧪 More fixture examples for the playground
- 📝 Tutorial-style docs (rendered at [keeylogger.github.io/modra](https://keeylogger.github.io/modra/))
- 🔌 New native bridge adapters (Ruby, Elixir, …)

---

## 📄 License

[MIT](./LICENSE) — use it however you like.

---

<div align="center">

⚡ **Modra v1.0.0** · *one file, a whole web app.*

[📖 Full docs](https://keeylogger.github.io/modra/) · [▶ Live playground](https://keeylogger.github.io/modra/README.html#/playground) · [🐙 GitHub](https://github.com/keeylogger/modra)

</div>
