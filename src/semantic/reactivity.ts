/**
 * Reactivity graph.
 *
 * For every reactive declaration (state, computed binding) we record:
 *  - the symbol it produces
 *  - the set of state symbols its initialiser depends on
 *
 * Plus, for every `ReactiveAssignStmt`, `SyncStmt`, and `BindStmt`,
 * we record the write target.
 *
 * The graph drives emitter behaviour:
 *  - Frontend: `useState` for primary state, `useMemo` / inline
 *    reactive expressions for derived state, callbacks for writes.
 *  - Backend: state without dependencies is constant; state with
 *    dependencies is recomputed on demand.
 */

import type {
  AnyNode,
  BindStmt,
  ElementDecl,
  FileNode,
  Identifier,
  ReactiveAssignStmt,
  SyncStmt,
} from "../ast/index.js";
import { walk } from "../ast/index.js";
import type { Resolver } from "./resolver.js";
import type { SymbolDecl } from "./symbols.js";

export interface ReactiveNode {
  /** The state symbol whose value depends on something. */
  symbol: SymbolDecl;
  /** Symbols read while computing the value (its dependencies). */
  reads: Set<SymbolDecl>;
  /** Source AST node responsible for the dependency edge. */
  source: ElementDecl | ReactiveAssignStmt | SyncStmt | BindStmt;
}

export interface ReactiveWrite {
  symbol: SymbolDecl;
  source: ReactiveAssignStmt | SyncStmt | BindStmt;
}

export class ReactivityGraph {
  readonly nodes: ReactiveNode[] = [];
  readonly writes: ReactiveWrite[] = [];

  /** Symbols that participate in reactivity (state, computed, two-way). */
  readonly reactiveSymbols = new Set<SymbolDecl>();

  /** Dependents map: for each state symbol, which other state symbols
   *  read it in their initialiser? (reverse of `reads`). */
  readonly dependents = new Map<SymbolDecl, Set<SymbolDecl>>();

  addNode(node: ReactiveNode): void {
    this.nodes.push(node);
    this.reactiveSymbols.add(node.symbol);
    node.symbol.reactive = true;
    for (const r of node.reads) {
      r.reactive = true;
      this.reactiveSymbols.add(r);
      let set = this.dependents.get(r);
      if (!set) {
        set = new Set();
        this.dependents.set(r, set);
      }
      set.add(node.symbol);
    }
  }

  addWrite(w: ReactiveWrite): void {
    this.writes.push(w);
    this.reactiveSymbols.add(w.symbol);
    w.symbol.reactive = true;
  }
}

export class ReactivityAnalyzer {
  readonly graph = new ReactivityGraph();
  private readonly resolver: Resolver;

  constructor(file: FileNode, resolver: Resolver) {
    this.resolver = resolver;
    walk(file, (node) => {
      if (node.kind === "ElementDecl") this.visitElementDecl(node);
      else if (node.kind === "ReactiveAssignStmt") this.visitReactiveAssign(node);
      else if (node.kind === "SyncStmt") this.visitSync(node);
      else if (node.kind === "BindStmt") this.visitBind(node);
      return;
    });
  }

  private visitElementDecl(decl: ElementDecl): void {
    if (!decl.name || !decl.init) return;
    const sym = this.resolver.resolution.lookup(decl.name);
    if (!sym || sym.kind !== "state") return;
    const reads = this.collectReads(decl.init);
    this.graph.addNode({ symbol: sym, reads, source: decl });
  }

  private visitReactiveAssign(s: ReactiveAssignStmt): void {
    if (s.target.kind !== "Identifier") return;
    const sym = this.resolver.resolution.lookup(s.target);
    if (!sym) return;
    this.graph.addWrite({ symbol: sym, source: s });
    const reads = this.collectReads(s.value);
    if (reads.size > 0) {
      this.graph.addNode({ symbol: sym, reads, source: s });
    }
  }

  private visitSync(s: SyncStmt): void {
    const left = s.left.kind === "Identifier" ? this.resolver.resolution.lookup(s.left) : null;
    const right = s.right.kind === "Identifier" ? this.resolver.resolution.lookup(s.right) : null;
    if (left) this.graph.addWrite({ symbol: left, source: s });
    if (right) this.graph.addWrite({ symbol: right, source: s });
    if (left && right) {
      this.graph.addNode({ symbol: left, reads: new Set([right]), source: s });
      this.graph.addNode({ symbol: right, reads: new Set([left]), source: s });
    }
  }

  private visitBind(s: BindStmt): void {
    const target = this.resolver.resolution.lookup(s.target);
    if (target) this.graph.addWrite({ symbol: target, source: s });
  }

  private collectReads(expr: AnyNode): Set<SymbolDecl> {
    const out = new Set<SymbolDecl>();
    walk(expr, (n, parent) => {
      if (n.kind === "Identifier") {
        if (parent && (parent.kind === "Member" && parent.property === n)) return false;
        if (parent && parent.kind === "ObjectEntry" && parent.key === n) return false;
        if (parent && parent.kind === "CallArg" && parent.name === n) return false;
        const sym = this.resolver.resolution.lookup(n as Identifier);
        if (sym && (sym.kind === "state" || sym.kind === "parameter" || sym.kind === "constant")) {
          out.add(sym);
        }
      }
      return;
    });
    return out;
  }
}
