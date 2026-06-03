/**
 * Client / server target classification.
 *
 * Rules:
 *  - `Endpoint` symbols default to `server`.
 *  - `Component`, `Style` default to `client`.
 *  - `Action` defaults to `client`, but if it calls a server-tagged
 *    symbol it gets the `crossesNetwork` flag.
 *  - `Database` and `Table` are `server`.
 *  - File-level state defaults to `client` unless used only inside
 *    Endpoint bodies.
 *  - `@@target` directives override (`@@target: Server`, `Client`,
 *    `Shared`).
 *
 * The result is stored on `SymbolDecl.target` AND on a per-node map
 * (`nodeTargets`) so emitters can split the file.
 */

import type {
  ActionDecl,
  AnyNode,
  ComponentDecl,
  Directive,
  EndpointDecl,
  FileNode,
  Identifier,
  StyleDecl,
} from "../ast/index.js";
import { walk } from "../ast/index.js";
import type { Resolver } from "./resolver.js";
import type { SymbolDecl, TargetClassification } from "./symbols.js";

export interface TargetingResult {
  /** Symbols that "cross the wire" (action calls endpoint → bridge). */
  bridgeCalls: Set<SymbolDecl>;
  /** For every directly-classified declaration node, its target. */
  nodeTargets: WeakMap<AnyNode, TargetClassification>;
}

export class TargetingPass {
  readonly result: TargetingResult = {
    bridgeCalls: new Set(),
    nodeTargets: new WeakMap(),
  };

  private readonly resolver: Resolver;
  private fileTarget: TargetClassification | null = null;

  constructor(file: FileNode, resolver: Resolver) {
    this.resolver = resolver;
    this.fileTarget = this.directiveOverride(file.directives, null as never) ?? null;
    this.classifyTopLevel(file);
    this.propagateThroughActions(file);
    this.fillDefaults();
  }

  private classifyTopLevel(file: FileNode): void {
    for (const d of file.declarations) {
      switch (d.kind) {
        case "EndpointDecl":
          // Endpoints are intrinsically server. File-level @@target
          // cannot override that; only decl-attached @@target can.
          this.tag(d, this.directiveOverride(d.directives, null) ?? "server");
          break;
        case "ComponentDecl":
          // Components are intrinsically client unless decl-attached
          // @@target says otherwise.
          this.tag(d, this.directiveOverride(d.directives, null) ?? "client");
          break;
        case "ActionDecl":
          this.tag(d, this.directiveOverride(d.directives, null) ?? "client");
          break;
        case "StyleDecl":
          this.tag(d, this.directiveOverride(d.directives, null) ?? "client");
          break;
        case "DatabaseDecl":
          for (const t of d.tables) {
            const tableSym = this.resolver.fileScope.lookupLocal(t.name.name);
            if (tableSym) tableSym.target = "server";
            this.result.nodeTargets.set(t, "server");
          }
          break;
        case "TypeDecl":
        case "ElementDecl": {
          // For ambiguous decls, file-level @@target wins; otherwise shared.
          const target: TargetClassification = this.fileTarget ?? "shared";
          if (d.kind === "ElementDecl" && d.name) {
            const sym = this.resolver.fileScope.lookupLocal(d.name.name);
            if (sym) sym.target = target;
          } else if (d.kind === "TypeDecl") {
            const sym = this.resolver.fileScope.lookupLocal(d.name.name);
            if (sym) sym.target = target;
          }
          this.result.nodeTargets.set(d, target);
          break;
        }
      }
    }
  }

  private tag(
    decl: ComponentDecl | EndpointDecl | ActionDecl | StyleDecl,
    target: TargetClassification,
  ): void {
    this.result.nodeTargets.set(decl, target);
    const sym = this.resolver.fileScope.lookupLocal(decl.name.name);
    if (sym) sym.target = target;
  }

  private directiveOverride(
    dirs: Directive[],
    fallback: TargetClassification | null,
  ): TargetClassification | null {
    for (const d of dirs) {
      if (d.name.name === "target") {
        const v = d.value?.kind === "Identifier" ? (d.value as Identifier).name.toLowerCase() : "";
        if (v === "server" || v === "client" || v === "shared") {
          return v as TargetClassification;
        }
      }
    }
    return fallback;
  }

  /** For each Action, if it references an Endpoint or Server-tagged
   *  symbol, mark it as bridge-crossing. */
  private propagateThroughActions(file: FileNode): void {
    for (const d of file.declarations) {
      if (d.kind !== "ActionDecl") continue;
      walk(d.body, (node) => {
        if (node.kind === "Call" && node.callee.kind === "Identifier") {
          const sym = this.resolver.resolution.lookup(node.callee);
          if (sym && sym.target === "server") {
            this.result.bridgeCalls.add(sym);
          }
        }
        return;
      });
    }
  }

  /** Fill in unknown targets with a sensible default. */
  private fillDefaults(): void {
    for (const sym of this.resolver.fileScope.allSymbols()) {
      if (sym.target === "unknown") {
        sym.target = "shared";
      }
    }
  }
}
