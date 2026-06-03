# Contributing to Modra

First, thanks for stopping by. Modra is small, opinionated, and still finding its
shape — every well-scoped issue, PR, or example moves the needle.

## Quick links

- 💬 Discussions: open one at [GitHub Discussions](../../discussions)
- 🐛 Bugs: [open an issue](../../issues/new?template=bug.yml)
- 💡 Feature ideas: [open an issue](../../issues/new?template=feature.yml)
- 📚 Documentation: see [`README.html`](./README.html) (full site) and [`README.md`](./README.md)

## Local setup

```bash
git clone https://github.com/<your-username>/modra.git
cd modra
npm install
npm test
```

You need **Node ≥ 20**. The whole compiler is plain TypeScript; there are no
native dependencies beyond what `npm install` will fetch for you (sharp is
optional and only used by the asset-build script).

## Useful scripts

| Command             | What it does                                                 |
|---------------------|--------------------------------------------------------------|
| `npm test`          | Runs the entire Vitest suite (≈ 300 tests, sub-second).      |
| `npm run dev`       | Runs the Modra CLI from source (`tsx src/cli.ts`).           |
| `npm run build`     | Type-checks and compiles `src/` into `dist/`.                |
| `npm run docs`      | Re-bundles the browser-side compiler for the docs site.      |
| `npm run docs:verify` | Sanity-checks every Modra block in `README.html`/`.md`.    |
| `npm run assets`    | Re-generates PNG / ICO / OG-image from the master SVGs.      |
| `npm run format`    | Prettier across `src/` and `tests/`.                         |

## Project layout

```
src/
  ast/            AST node types + visitor
  lexer/          Token producer
  parser/         Recursive-descent parser (+ Pratt for expressions)
  semantic/       Name resolution, types, reactivity, targeting
  emit/           React / Node / Postgres / bridge emitters
  utils/          Diagnostics formatting helpers
  cli.ts          Entry point for `modra init|build|dev|lex|parse`

tests/            Vitest suites mirroring src/
docs/             Static SPA assets (styles, bundled compiler, playground)
assets/           Master SVG logos + generated PNGs
scripts/          Asset builder, docs bundler, docs verifier
```

## Submitting a change

1. **Open an issue first** for anything bigger than a typo. It saves you (and us)
   a wasted round-trip.
2. **Fork → branch → PR.** Branch names like `fix/parser-newline-eof` or
   `feat/emit-trpc-bridge` are appreciated.
3. **Write a test.** Every bug fix should land with the failing test that proved
   it. Every new emitter feature should add a fixture.
4. **Run the full check before pushing**:
   ```bash
   npm test
   npm run docs:verify
   ```
5. **Keep the PR focused.** One observable change per PR. If you touch the
   parser AND the React emitter, those should be two PRs unless one depends on
   the other.

## Style

- TypeScript with `"strict": true`.
- Use Prettier (`npm run format`) — no manual formatting debates, please.
- Prefer named exports.
- Diagnostics use the `MOD-Pxxx` / `MOD-Sxxx` / `MOD-Exxx` prefix scheme already
  established in `src/utils/pretty-diagnostics.ts`.

## Adding a new diagnostic

1. Pick an unused code in the appropriate range.
2. Add a friendly title + hint in `pretty-diagnostics.ts`.
3. Cover both the failing input (negative test) and the happy path (positive
   test) under `tests/`.

## License

Anything you contribute is licensed under [MIT](./LICENSE), same as the rest of
the project.
