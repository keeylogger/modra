# Modra examples

Hand-written, real Modra programs that build on each other. Each file is a
**complete, single-file app** — Modra compiles every one of them into a full
React + Node + Postgres project tree.

> **Try them live on the docs site.** Every example below has an interactive
> "what it builds" demo on
> [keeylogger.github.io/modra/README.html#/examples](https://keeylogger.github.io/modra/README.html#/examples)
> — the Modra source on the left, the compiled React app running on the right.

| #  | File                          | Showcases                                                       | Live demo |
|----|-------------------------------|-----------------------------------------------------------------|-----------|
| 01 | `01-counter.modra`            | Reactive state + actions, the "hello world" of Modra            | [▶ open](https://keeylogger.github.io/modra/docs/demos/01-counter.html) |
| 02 | `02-todo-list.modra`          | Array state, list mutation, `InputField::` binding, `forEach`   | [▶ open](https://keeylogger.github.io/modra/docs/demos/02-todo-list.html) |
| 03 | `03-registration.modra`       | Full-stack form: Postgres schema, hashed password, server call  | [▶ open](https://keeylogger.github.io/modra/docs/demos/03-registration.html) |
| 04 | `04-blog.modra`               | Multiple related tables, query endpoints, derived counts        | [▶ open](https://keeylogger.github.io/modra/docs/demos/04-blog.html) |
| 05 | `05-storefront.modra`         | Cart state, multi-step `Checkout` endpoint, `Toast` notification| [▶ open](https://keeylogger.github.io/modra/docs/demos/05-storefront.html) |
| 06 | `06-dashboard.modra`          | Time-windowed queries, group-by, derived KPIs                   | [▶ open](https://keeylogger.github.io/modra/docs/demos/06-dashboard.html) |
| 07 | `07-realtime-chat.modra`      | Per-channel message log, polling endpoint, send action          | [▶ open](https://keeylogger.github.io/modra/docs/demos/07-realtime-chat.html) |
| 08 | `08-native-bridge.modra`      | Embedded Python/TS/Bash via `Native<Lang> { … }`                | [▶ open](https://keeylogger.github.io/modra/docs/demos/08-native-bridge.html) |

> The "live demo" pages are hand-written React + Tailwind that mimic what the
> Modra compiler emits, with in-memory mocks for the Postgres/RPC layer. They
> exist so the docs site can show you the *output* of every example — not just
> the source. See [`docs/demos/`](../docs/demos/) for the HTML.

## Verifying them

Every file is checked by CI:

```bash
node scripts/verify-examples.mjs
```

The script loads the real Modra compiler bundle (`docs/modra-bundle.js`) and
parses every `*.modra` file in this folder. CI fails if any of them stop
parsing cleanly.

## Building one

```bash
modra build examples/03-registration.modra -o ./out
cd out
npm install
npm run dev
```

The emitted tree contains:

- `src/`            — React + TypeScript frontend (one component per `Component:`)
- `server/`         — Node + Express handlers (one per `Endpoint:`)
- `db/schema.sql`   — Postgres DDL (one statement per `Table:`)
- `shared/types.ts` — RPC types shared between client and server

## Reading order

1. **01-counter** — meet the reactive `<-` operator and `Action:` blocks
2. **02-todo-list** — see how lists, two-way bindings, and `forEach` work
3. **03-registration** — your first taste of full-stack: client + server + db
4. **04-blog** / **05-storefront** — multi-table apps with relationships
5. **06-dashboard** / **07-realtime-chat** — query patterns and polling
6. **08-native-bridge** — drop into another language when you need to
