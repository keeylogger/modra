# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Brand identity (green hex panels + faceted red M logo, full asset pipeline).
- Public single-file documentation site (`README.html`) with live playground.

## [1.0.0] - 2026-06-03

First public alpha. The full compiler pipeline is implemented end-to-end.

### Added
- **Phase 1 — Lexer**: Token producer for the full Modra grammar.
- **Phase 2 — Parser & AST**: Recursive-descent + Pratt expression parser with
  panic-mode recovery and 95 % statement / expression coverage.
- **Phase 3 — Semantic analysis**: Name resolution, nominal type system,
  reactivity graph, and client/server/shared target classification.
- **Phase 4 — Emitters**:
  - React + TypeScript + Vite frontend
  - Node + Express backend
  - Postgres DDL + typed query API
  - Typed fetch bridge between client and server
  - Native escape hatches (Python / TypeScript / Go / Rust stubs)
- **Phase 5 — Standard library**: `Math`, `Json`, `Time`, `Strings`, `Arrays`,
  `Console`, plus `Server.*` runtime helpers.
- **Phase 6 — Diagnostics**: Rust-style multi-line caret diagnostics with
  source spans, related notes, and hint messages.
- **Phase 7 — CLI**: `modra init | build | dev | lex | parse`, with a fully
  scaffolded starter project produced by `init`.
- 294 passing unit and fixture tests covering every layer of the pipeline.
- Single-file documentation site (`README.html`) with a routed SPA, live
  playground driven by a browser-bundled compiler, and per-language comparison
  tables.

[Unreleased]: https://github.com/Mistrioso1/modra/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Mistrioso1/modra/releases/tag/v1.0.0
