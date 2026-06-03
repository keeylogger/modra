/**
 * Name resolution.
 *
 * Two passes:
 *  1. `collect`: walk the AST and declare every top-level / nested
 *     symbol into the appropriate scope.
 *  2. `resolve`: walk again, looking up each `Identifier` reference
 *     and recording the resolved `SymbolDecl` on the node's metadata.
 *
 * The resolver also installs implicit globals: built-in functions
 * (`UUID()`, `Now()`, `Log()`) and the magic globals (`__module__`,
 * `__file__`, `__line__`).
 *
 * Diagnostics emitted use the `MOD-S0xx` prefix.
 */

import type {
  ActionDecl,
  AnyNode,
  Block,
  ColumnDecl,
  ComponentDecl,
  DatabaseDecl,
  ElementDecl,
  EndpointDecl,
  FileNode,
  Identifier,
  Parameter,
  StyleDecl,
  TopLevelDecl,
  UsingDecl,
} from "../ast/index.js";
import { walk } from "../ast/index.js";
import type { DiagnosticCollector } from "../utils/diagnostics.js";
import { makeSymbol, Scope, type SymbolDecl, type SymbolKind } from "./symbols.js";

/**
 * Resolved-symbol annotation attached to identifier nodes. We avoid
 * mutating AST node types directly — instead the resolver keeps a
 * `WeakMap<Identifier, SymbolDecl>` lookup table the rest of the
 * compiler consults.
 */
export class ResolutionMap {
  private readonly idToSymbol = new WeakMap<Identifier, SymbolDecl>();
  private readonly nodeScope = new WeakMap<AnyNode, Scope>();

  bind(id: Identifier, sym: SymbolDecl): void {
    this.idToSymbol.set(id, sym);
    sym.references.push(id);
  }
  lookup(id: Identifier): SymbolDecl | null {
    return this.idToSymbol.get(id) ?? null;
  }
  setNodeScope(node: AnyNode, scope: Scope): void {
    this.nodeScope.set(node, scope);
  }
  getNodeScope(node: AnyNode): Scope | null {
    return this.nodeScope.get(node) ?? null;
  }
}

export class Resolver {
  readonly fileScope: Scope;
  readonly resolution = new ResolutionMap();
  private readonly diag: DiagnosticCollector;
  private readonly filePath: string;

  constructor(file: FileNode, diag: DiagnosticCollector, filePath: string) {
    this.fileScope = new Scope(null, "file");
    this.diag = diag;
    this.filePath = filePath;
    installBuiltinGlobals(this.fileScope);
    this.collectTopLevel(file);
    this.resolveFile(file);
  }

  // ─── Collection pass ────────────────────────────────────────
  private collectTopLevel(file: FileNode): void {
    this.resolution.setNodeScope(file, this.fileScope);
    for (const u of file.usings) {
      this.declareUsing(u);
    }
    for (const decl of file.declarations) {
      this.declareTopLevel(decl, this.fileScope);
    }
  }

  private declareUsing(u: UsingDecl): void {
    const alias = u.alias?.name ?? u.path.parts[u.path.parts.length - 1]!.name;
    const sym = makeSymbol(alias, "module", u, this.fileScope);
    sym.meta.path = u.path.parts.map((p) => p.name).join(".");
    sym.target = "shared";
    // `using` is allowed to shadow built-in modules silently (e.g. the
    // user re-aliasing `DB` to a different backend module).
    const existing = this.fileScope.lookupLocal(alias);
    if (existing && existing.meta.builtin === true) {
      // overwrite — we can't truly delete from the Scope, but redeclare
      // works because we replace the entry in the symbols map.
      (existing as unknown as Record<string, unknown>).declarationNode = sym.declarationNode;
      (existing as unknown as Record<string, unknown>).meta = sym.meta;
      (existing as unknown as Record<string, unknown>).target = sym.target;
      if (u.alias) this.resolution.bind(u.alias, existing);
      return;
    }
    this.declareOrError(this.fileScope, sym);
    if (u.alias) this.resolution.bind(u.alias, sym);
  }

  private declareTopLevel(decl: TopLevelDecl, scope: Scope): void {
    switch (decl.kind) {
      case "StyleDecl":
        this.declareNamed(scope, decl.name.name, "style", decl, decl.name);
        return;
      case "ComponentDecl":
        this.declareNamed(scope, decl.name.name, "component", decl, decl.name);
        return;
      case "EndpointDecl":
        this.declareNamed(scope, decl.name.name, "endpoint", decl, decl.name);
        return;
      case "ActionDecl":
        this.declareNamed(scope, decl.name.name, "action", decl, decl.name);
        return;
      case "DatabaseDecl":
        this.declareDatabase(decl, scope);
        return;
      case "TypeDecl":
        this.declareNamed(scope, decl.name.name, "type-alias", decl, decl.name);
        return;
      case "ElementDecl":
        this.declareElementDecl(decl, scope);
        return;
      case "ErrorDecl":
        return;
    }
  }

  private declareNamed(
    scope: Scope,
    name: string,
    kind: SymbolKind,
    decl: SymbolDecl["declarationNode"],
    bindIdent: Identifier | null = null,
  ): SymbolDecl {
    const sym = makeSymbol(name, kind, decl, scope);
    this.declareOrError(scope, sym);
    if (bindIdent) this.resolution.bind(bindIdent, sym);
    return sym;
  }

  private declareElementDecl(decl: ElementDecl, scope: Scope): void {
    if (decl.name) {
      // `Label: Name <- value` declares `Name` as state.
      const kind: SymbolKind = decl.init !== null ? "state" : "constant";
      const sym = makeSymbol(decl.name.name, kind, decl, scope);
      this.declareOrError(scope, sym);
      this.resolution.bind(decl.name, sym);
    } else if (decl.label.name === "__annotation__") {
      // Orphan annotation placeholder — nothing to declare.
    }
  }

  private declareDatabase(db: DatabaseDecl, scope: Scope): void {
    // Database itself is anonymous at file scope; we declare its tables
    // under their own names.
    for (const t of db.tables) {
      const tableSym = this.declareNamed(scope, t.name.name, "table", t, t.name);
      const tableScope = new Scope(scope, `table ${t.name.name}`);
      this.resolution.setNodeScope(t, tableScope);
      for (const col of t.columns) {
        this.declareColumn(col, tableScope);
      }
      tableSym.meta.columns = t.columns.map((c) => c.name.name);
      tableSym.meta.backend = db.backend.name;
    }
  }

  private declareColumn(col: ColumnDecl, scope: Scope): void {
    const sym = makeSymbol(col.name.name, "column", col, scope);
    sym.meta.columnDecl = col;
    this.declareOrError(scope, sym);
    this.resolution.bind(col.name, sym);
  }

  private declareOrError(scope: Scope, sym: SymbolDecl): void {
    const result = scope.declare(sym);
    if (result !== "ok") {
      // Duplicate symbol in the same scope.
      const node = sym.declarationNode;
      this.diag.error({
        code: "MOD-S001",
        message: `Duplicate declaration of '${sym.name}' in ${scope.label}.`,
        span: "span" in node ? node.span : { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } },
        file: this.filePath,
      });
    }
  }

  // ─── Resolution pass ────────────────────────────────────────
  private resolveFile(file: FileNode): void {
    for (const decl of file.declarations) {
      this.resolveTopLevel(decl, this.fileScope);
    }
  }

  private resolveTopLevel(decl: TopLevelDecl, scope: Scope): void {
    switch (decl.kind) {
      case "ComponentDecl":
        this.resolveComponent(decl, scope);
        return;
      case "EndpointDecl":
        this.resolveEndpoint(decl, scope);
        return;
      case "ActionDecl":
        this.resolveAction(decl, scope);
        return;
      case "StyleDecl":
        this.resolveStyle(decl, scope);
        return;
      case "DatabaseDecl":
        for (const t of decl.tables) {
          const tableScope = this.resolution.getNodeScope(t) ?? scope;
          for (const col of t.columns) {
            if (col.init) this.resolveExpression(col.init, tableScope);
          }
        }
        return;
      case "TypeDecl":
        return;
      case "ElementDecl":
        this.resolveElementDecl(decl, scope);
        return;
      case "ErrorDecl":
        return;
    }
  }

  private resolveComponent(c: ComponentDecl, parent: Scope): void {
    const scope = new Scope(parent, `component ${c.name.name}`);
    this.resolution.setNodeScope(c, scope);
    for (const p of c.params) this.declareParam(p, scope);
    this.resolveBlock(c.body, scope);
  }

  private resolveEndpoint(e: EndpointDecl, parent: Scope): void {
    const scope = new Scope(parent, `endpoint ${e.name.name}`);
    this.resolution.setNodeScope(e, scope);
    for (const p of e.params) this.declareParam(p, scope);
    this.resolveBlock(e.body, scope);
  }

  private resolveAction(a: ActionDecl, parent: Scope): void {
    const scope = new Scope(parent, `action ${a.name.name}`);
    this.resolution.setNodeScope(a, scope);
    for (const p of a.params) this.declareParam(p, scope);
    this.resolveBlock(a.body, scope);
  }

  private resolveStyle(s: StyleDecl, parent: Scope): void {
    const scope = new Scope(parent, `style ${s.name.name}`);
    this.resolution.setNodeScope(s, scope);
    for (const item of s.body) this.resolveElementDecl(item, scope);
  }

  private declareParam(p: Parameter, scope: Scope): void {
    const sym = makeSymbol(p.name.name, "parameter", p, scope);
    this.declareOrError(scope, sym);
    this.resolution.bind(p.name, sym);
  }

  private resolveBlock(block: Block, parent: Scope): void {
    // Each block introduces a nested scope for forEach bindings etc.
    const scope = new Scope(parent, "block");
    this.resolution.setNodeScope(block, scope);
    // First pass: declare local element-decls so later siblings can see them.
    for (const item of block.items) {
      if (item.kind === "ElementDecl") {
        this.declareElementDecl(item, scope);
      } else if (item.kind === "ComponentDecl") {
        this.declareTopLevel(item, scope);
      } else if (item.kind === "StyleDecl") {
        this.declareTopLevel(item, scope);
      }
    }
    // Second pass: resolve each item's expressions / nested blocks.
    for (const item of block.items) {
      this.resolveBlockItem(item, scope);
    }
  }

  private resolveBlockItem(item: AnyNode, scope: Scope): void {
    switch (item.kind) {
      case "ElementDecl":
        this.resolveElementDecl(item, scope);
        return;
      case "ComponentDecl":
        this.resolveComponent(item, scope);
        return;
      case "EndpointDecl":
        this.resolveEndpoint(item, scope);
        return;
      case "ActionDecl":
        this.resolveAction(item, scope);
        return;
      case "StyleDecl":
        this.resolveStyle(item, scope);
        return;
      case "IfStmt":
        for (const b of item.branches) {
          if (b.condition) this.resolveExpression(b.condition, scope);
          this.resolveBlock(b.body, scope);
        }
        return;
      case "WhileStmt":
        this.resolveExpression(item.condition, scope);
        this.resolveBlock(item.body, scope);
        return;
      case "ForEachStmt": {
        this.resolveExpression(item.iterable, scope);
        const loopScope = new Scope(scope, "forEach");
        const sym = makeSymbol(item.binding.name, "constant", item.binding, loopScope);
        this.declareOrError(loopScope, sym);
        this.resolution.setNodeScope(item.body, loopScope);
        // Resolve the body in the loop scope (not a fresh one).
        for (const sub of item.body.items) this.resolveBlockItem(sub, loopScope);
        return;
      }
      case "LoopStmt":
        this.resolveBlock(item.body, scope);
        return;
      case "RepeatStmt":
        this.resolveExpression(item.count, scope);
        this.resolveBlock(item.body, scope);
        return;
      case "MatchStmt":
        this.resolveExpression(item.scrutinee, scope);
        for (const c of item.cases) {
          if (c.pattern) this.resolveExpression(c.pattern, scope);
          if (c.body.kind === "Block") this.resolveBlock(c.body, scope);
          else this.resolveExpression(c.body, scope);
        }
        return;
      case "AttemptStmt":
        this.resolveBlock(item.body, scope);
        if (item.recoverBody) {
          const recScope = new Scope(scope, "recover");
          this.resolution.setNodeScope(item.recoverBody, recScope);
          if (item.recoverBinding) {
            const sym = makeSymbol(item.recoverBinding.name, "constant", item.recoverBinding, recScope);
            this.declareOrError(recScope, sym);
          }
          for (const sub of item.recoverBody.items) this.resolveBlockItem(sub, recScope);
        }
        if (item.ensureBody) this.resolveBlock(item.ensureBody, scope);
        return;
      case "TransactionStmt":
      case "ParallelStmt":
      case "SequenceStmt":
        this.resolveBlock(item.body, scope);
        return;
      case "EventWireStmt":
        this.resolveExpression(item.event, scope);
        if (item.handler.kind === "Block") this.resolveBlock(item.handler, scope);
        else this.resolveExpression(item.handler, scope);
        return;
      case "BindStmt":
        this.resolveIdentifier(item.target, scope);
        if (item.attrs) this.resolveAttrList(item.attrs, scope);
        return;
      case "ApplyEffectStmt":
        this.resolveExpression(item.target, scope);
        this.resolveExpression(item.effect, scope);
        return;
      case "ReactiveAssignStmt":
        this.resolveExpression(item.target, scope);
        this.resolveExpression(item.value, scope);
        return;
      case "SyncStmt":
        this.resolveExpression(item.left, scope);
        this.resolveExpression(item.right, scope);
        return;
      case "ReturnStmt":
      case "YieldStmt":
        if (item.value) this.resolveExpression(item.value, scope);
        return;
      case "ThrowStmt":
        this.resolveExpression(item.value, scope);
        return;
      case "RequireStmt":
      case "AssertStmt":
      case "ExpectStmt":
        this.resolveExpression(item.condition, scope);
        return;
      case "ExpressionStmt":
        this.resolveExpression(item.expression, scope);
        return;
      case "BreakStmt":
      case "ContinueStmt":
      case "ErrorStmt":
        return;
      default:
        return;
    }
  }

  private resolveElementDecl(decl: ElementDecl, scope: Scope): void {
    if (decl.base) this.resolveIdentifier(decl.base, scope);
    if (decl.attrs) this.resolveAttrList(decl.attrs, scope);
    if (decl.init) this.resolveExpression(decl.init, scope);
    if (decl.body) {
      if (decl.body.kind === "Block") this.resolveBlock(decl.body, scope);
      else this.resolveExpression(decl.body, scope);
    }
  }

  private resolveAttrList(attrs: { entries: { key: Identifier | null; value: { kind: string } | null; bindTarget: Identifier | null }[] }, scope: Scope): void {
    for (const a of attrs.entries) {
      if (a.bindTarget) {
        // `InputField::Name` declares-and-binds an implicit state
        // variable `Name` at the enclosing form's scope. If it doesn't
        // already exist in scope, auto-declare it.
        this.bindOrAutoDeclare(a.bindTarget, scope);
      }
      if (a.value) {
        // Attribute values are commonly stylistic enums (`Size: Medium`)
        // or event-handler references (`Click -> SubmitRegistration`).
        // We resolve silently and only catch typos via subsequent passes.
        if (a.value.kind === "Identifier") {
          this.resolveIdentifier(a.value as unknown as Identifier, scope, { silent: true });
        } else {
          this.resolveExpression(a.value as never, scope);
        }
      }
    }
  }

  private bindOrAutoDeclare(id: Identifier, scope: Scope): void {
    const existing = scope.lookup(id.name);
    if (existing) {
      this.resolution.bind(id, existing);
      return;
    }
    // Auto-declare as state. This is the "implicit state" feature of
    // two-way bindings (`InputField::Email` creates `Email`).
    const sym = makeSymbol(id.name, "state", id, scope);
    sym.meta.autoDeclared = true;
    scope.declare(sym);
    this.resolution.bind(id, sym);
  }

  private resolveExpression(expr: AnyNode, scope: Scope): void {
    if (!expr) return;
    walk(expr, (node) => {
      if (node === expr) return;
      // Stop descending into things that have their own scopes (we
      // handle them via resolveBlock).
      if (node.kind === "Block") return false;
      if (node.kind === "Identifier") {
        // Skip the property side of a Member (it's not a free reference).
        // The walker visits Member.object then Member.property, but the
        // parent context tells us if we should resolve.
        // We do a global resolution attempt; failures only diagnose for
        // free identifiers (handled below via parent inspection).
        // For Phase 3 simplicity, attempt resolution always — but only
        // emit a diagnostic for "free" identifiers (not member
        // properties, not object keys).
        // The visitor pattern doesn't give us parent context easily, so
        // we use a heuristic: skip identifiers that look like type
        // names (starts with uppercase and matches a built-in type).
        this.resolveIdentifier(node as Identifier, scope, { silent: true });
      }
      return;
    });
    // Walk again with parent-aware handling for diagnostics on free refs.
    this.resolveExpressionRefs(expr, scope);
  }

  private resolveExpressionRefs(expr: AnyNode, scope: Scope): void {
    // Visit identifiers that are NOT in property position.
    visitFreeIdentifiers(expr, (id) => {
      this.resolveIdentifier(id, scope);
    });
  }

  private resolveIdentifier(
    id: Identifier,
    scope: Scope,
    opts: { silent?: boolean } = {},
  ): SymbolDecl | null {
    const existing = this.resolution.lookup(id);
    if (existing) return existing;
    const sym = scope.lookup(id.name);
    if (sym) {
      this.resolution.bind(id, sym);
      return sym;
    }
    // Built-in identifiers (CSS-ish, layout-ish) aren't in the symbol
    // table — we leave them unresolved without erroring. Truly free
    // references that don't fit any pattern get MOD-S002.
    if (!opts.silent && shouldErrorOnFreeRef(id.name)) {
      this.diag.error({
        code: "MOD-S002",
        message: `Cannot find name '${id.name}'.`,
        span: id.span,
        file: this.filePath,
      });
    }
    return null;
  }
}

/** Free identifiers that look like literal-ish values (style enums,
 *  built-in constants we haven't modelled, etc.) shouldn't error.
 *  Convention: lowercase-only is a likely free attribute value. */
function shouldErrorOnFreeRef(name: string): boolean {
  // Don't error on common stylistic enum names: pop, fade, slide, …
  if (/^[a-z]+$/.test(name)) return false;
  // Don't error on magic globals like __module__, __file__, __line__.
  if (/^__[a-z]+__$/.test(name)) return false;
  return true;
}

/**
 * Visit every identifier that's a "free" reference — i.e. not the
 * property side of a member, not the key of an object-entry, not the
 * declared name in a parameter / element / attribute pair.
 */
function visitFreeIdentifiers(root: AnyNode, fn: (id: Identifier) => void): void {
  const visit = (node: AnyNode, parent: AnyNode | null): void => {
    if (node.kind === "Identifier" && isFreeReferenceContext(parent, node)) {
      fn(node);
    }
    // Descend manually to skip identifier-in-property positions.
    for (const child of childrenForFreeRefs(node)) visit(child, node);
  };
  visit(root, null);
}

/** Children of a node that we recurse into for free-identifier discovery. */
function* childrenForFreeRefs(node: AnyNode): Iterable<AnyNode> {
  switch (node.kind) {
    case "Member":
      yield node.object;
      return; // do NOT visit `property`
    case "ObjectEntry":
      yield node.value;
      return; // do NOT visit `key`
    case "CallArg":
      yield node.value;
      return; // do NOT visit named-arg `name`
    case "Block":
      return; // owned by resolveBlock; skip
    case "Decorator":
      for (const a of node.args) yield a;
      return;
    case "Directive":
      for (const a of node.args) yield a;
      if (node.value) yield node.value;
      return;
    default: {
      // Generic: yield all child AST nodes via the visitor's
      // childrenOf (but we don't import to avoid the cycle).
      const obj = node as unknown as Record<string, unknown>;
      for (const key of Object.keys(obj)) {
        if (key === "kind" || key === "span") continue;
        const v = obj[key];
        if (Array.isArray(v)) {
          for (const item of v) {
            if (item && typeof item === "object" && "kind" in item) {
              yield item as AnyNode;
            }
          }
        } else if (v && typeof v === "object" && "kind" in v) {
          yield v as AnyNode;
        }
      }
    }
  }
}

function isFreeReferenceContext(parent: AnyNode | null, id: Identifier): boolean {
  if (!parent) return true;
  switch (parent.kind) {
    case "Member":
      return parent.object === id; // not the property
    case "ObjectEntry":
      return parent.value === id; // not the key
    case "CallArg":
      return parent.value === id; // not the named-arg label
    case "Decorator":
      // Decorator arguments may be free refs; decorator name is syntactic.
      return parent.name !== id;
    case "Directive":
      // Directive arguments / value are enum-like literals, NOT free refs.
      // (e.g. `@@target: Server`, `@@reactive: off`, `@@experimental(nativeBridges)`)
      return false;
    case "Attribute":
      // Both key and value of attributes are mostly syntactic / enum-like
      // (e.g. `InputField::Name`, `Size: Medium`, `Click -> Handler`).
      // Skip everything here; emitters consult attributes structurally.
      return false;
    case "NativeBridge":
      // language / in / out identifiers are syntactic markers.
      return false;
    case "Parameter":
      return parent.defaultValue === id;
    case "ElementDecl":
    case "ComponentDecl":
    case "EndpointDecl":
    case "ActionDecl":
    case "StyleDecl":
    case "TableDecl":
    case "ColumnDecl":
    case "TypeDecl":
    case "UsingDecl":
      return false; // the decl's identifier-children are syntactic
    case "TypeRef":
      return false;
    case "DottedName":
      return false;
    default:
      return true;
  }
}

function installBuiltinGlobals(scope: Scope): void {
  const builtins: { name: string; kind: SymbolKind; target?: "client" | "server" | "shared" }[] = [
    // Functions
    { name: "UUID", kind: "constant" },
    { name: "Now", kind: "constant" },
    { name: "Log", kind: "constant" },
    { name: "Print", kind: "constant" },
    { name: "Error", kind: "type-alias" },
    { name: "AuthToken", kind: "constant" },
    // RPC / target namespaces (the magic `Server.X(...)` form)
    { name: "Server", kind: "module", target: "server" },
    { name: "Client", kind: "module", target: "client" },
    // Database namespace (`DB.Users.Insert(...)`)
    { name: "DB", kind: "module", target: "server" },
    // Built-in components / actions used in fixtures
    { name: "Toast", kind: "component", target: "client" },
    { name: "Show", kind: "component", target: "client" },
    { name: "Animate", kind: "component", target: "client" },
    { name: "Navigate", kind: "action", target: "client" },
    { name: "Submit", kind: "component", target: "client" },
    { name: "Form", kind: "component", target: "client" },
    { name: "InputField", kind: "component", target: "client" },
    { name: "Window", kind: "component", target: "client" },
    { name: "Header", kind: "component", target: "client" },
    { name: "Title", kind: "component", target: "client" },
    { name: "Text", kind: "component", target: "client" },
    { name: "Button", kind: "component", target: "client" },
    { name: "Image", kind: "component", target: "client" },
    { name: "Card", kind: "component", target: "client" },
    { name: "Grid", kind: "component", target: "client" },
    { name: "List", kind: "component", target: "client" },
    { name: "Container", kind: "component", target: "client" },
    { name: "Row", kind: "component", target: "client" },
    { name: "Column", kind: "component", target: "client" },
    { name: "Spacer", kind: "component", target: "client" },
    { name: "Icon", kind: "component", target: "client" },
    { name: "Link", kind: "component", target: "client" },
    // Style / layout namespaces (`Flex.Between`, `Size.Medium`, `Color.Red`)
    { name: "Flex", kind: "module", target: "client" },
    { name: "Size", kind: "module", target: "client" },
    { name: "Color", kind: "module", target: "client" },
    { name: "Align", kind: "module", target: "client" },
    { name: "Layout", kind: "module", target: "client" },
    { name: "Theme", kind: "module", target: "client" },
    { name: "Style", kind: "module", target: "client" },
    { name: "Position", kind: "module", target: "client" },
    { name: "Anim", kind: "module", target: "client" },
    { name: "Effect", kind: "module", target: "client" },
    // Database backends
    { name: "Postgres", kind: "module", target: "server" },
    { name: "MySQL", kind: "module", target: "server" },
    { name: "SQLite", kind: "module", target: "server" },
    { name: "Mongo", kind: "module", target: "server" },
    // Common type names accessible as identifiers
    { name: "Record", kind: "type-alias" },
    { name: "String", kind: "type-alias" },
    { name: "Number", kind: "type-alias" },
    { name: "Bool", kind: "type-alias" },
    { name: "DateTime", kind: "type-alias" },
    { name: "Response", kind: "type-alias" },
    // Literals
    { name: "true", kind: "constant" },
    { name: "false", kind: "constant" },
    { name: "none", kind: "constant" },
    // Magic globals
    { name: "__module__", kind: "constant" },
    { name: "__file__", kind: "constant" },
    { name: "__line__", kind: "constant" },
  ];
  for (const b of builtins) {
    const sym = makeSymbol(b.name, b.kind, makeBuiltinDeclNode(b.name), scope);
    sym.target = b.target ?? "shared";
    sym.meta.builtin = true;
    scope.declare(sym);
  }
}

function makeBuiltinDeclNode(name: string): Identifier {
  return {
    kind: "Identifier",
    name,
    span: { start: { line: 0, column: 0, offset: 0 }, end: { line: 0, column: 0, offset: 0 } },
  };
}
