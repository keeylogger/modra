/**
 * Symbol tables and lexical scopes.
 *
 * A `Scope` is a lexical region — file, component, action, endpoint,
 * block. Scopes nest: identifier lookup walks up the parent chain.
 *
 * Each `Symbol` records what the identifier refers to (its `kind`),
 * the AST node it was declared at, an optional `Type`, and a
 * `TargetClassification` (filled in by the targeting pass).
 *
 * Symbols are intentionally mutable: passes (resolver -> type-checker
 * -> reactivity -> targeting) decorate them over time. By the end of
 * Phase 3 every symbol has a resolved type and a target.
 */

import type {
  ActionDecl,
  ColumnDecl,
  ComponentDecl,
  DatabaseDecl,
  ElementDecl,
  EndpointDecl,
  Identifier,
  Parameter,
  StyleDecl,
  TableDecl,
  TypeDecl,
  UsingDecl,
} from "../ast/index.js";
import type { Type } from "./types.js";

export type SymbolKind =
  | "state" // `Number: CartCount <- 0` (reactive variable)
  | "constant" // attribute / read-only binding
  | "parameter" // Component / Endpoint / Action parameter
  | "component"
  | "endpoint"
  | "action"
  | "style"
  | "table"
  | "column"
  | "type-alias"
  | "module" // `using Foo.Bar as B` — alias for an import root
  | "ui-element"; // a UI element declared inline (`Window: StoreFront -> ...`)

export type TargetClassification = "client" | "server" | "shared" | "unknown";

export interface SymbolDecl {
  /** The unique name of the symbol within its scope. */
  name: string;
  kind: SymbolKind;
  /** The AST node where the symbol was first declared. */
  declarationNode:
    | ElementDecl
    | ComponentDecl
    | EndpointDecl
    | ActionDecl
    | StyleDecl
    | DatabaseDecl
    | TableDecl
    | ColumnDecl
    | TypeDecl
    | UsingDecl
    | Parameter
    | Identifier;
  /** The lexical scope this symbol lives in. */
  scope: Scope;
  /** Resolved type (null until the type-checker visits this symbol). */
  type: Type | null;
  /** Reactive? Set by the reactivity pass for `state`-kind symbols. */
  reactive: boolean;
  /** Where this symbol is allowed to live (client / server / shared). */
  target: TargetClassification;
  /** Set of identifier nodes that reference this symbol. */
  references: Identifier[];
  /** Free-form metadata used by later passes (e.g. table -> columns). */
  meta: Record<string, unknown>;
}

export class Scope {
  readonly parent: Scope | null;
  /** Human-readable label for diagnostics (e.g. "Component Cart"). */
  readonly label: string;
  private readonly symbols = new Map<string, SymbolDecl>();
  /** Children scopes — useful for emitters that walk the tree. */
  readonly children: Scope[] = [];

  constructor(parent: Scope | null, label: string) {
    this.parent = parent;
    this.label = label;
    if (parent) parent.children.push(this);
  }

  /** Declare a new symbol in this scope. Returns the existing one on
   *  conflict so the caller can raise a diagnostic. */
  declare(sym: SymbolDecl): SymbolDecl | "ok" {
    const existing = this.symbols.get(sym.name);
    if (existing) return existing;
    this.symbols.set(sym.name, sym);
    return "ok";
  }

  /** Look up a symbol by name in this scope (no parent walk). */
  lookupLocal(name: string): SymbolDecl | null {
    return this.symbols.get(name) ?? null;
  }

  /** Look up a symbol by name walking up to file scope. */
  lookup(name: string): SymbolDecl | null {
    let cur: Scope | null = this;
    while (cur) {
      const s = cur.symbols.get(name);
      if (s) return s;
      cur = cur.parent;
    }
    return null;
  }

  /** All symbols declared directly in this scope. */
  ownSymbols(): SymbolDecl[] {
    return Array.from(this.symbols.values());
  }

  /** Depth-first list of every symbol in this scope and descendants. */
  allSymbols(): SymbolDecl[] {
    const out: SymbolDecl[] = [...this.symbols.values()];
    for (const child of this.children) {
      out.push(...child.allSymbols());
    }
    return out;
  }
}

export function makeSymbol(
  name: string,
  kind: SymbolKind,
  declarationNode: SymbolDecl["declarationNode"],
  scope: Scope,
): SymbolDecl {
  return {
    name,
    kind,
    declarationNode,
    scope,
    type: null,
    reactive: false,
    target: "unknown",
    references: [],
    meta: {},
  };
}
