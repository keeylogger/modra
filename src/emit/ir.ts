/**
 * Emitter IR — a target-neutral intermediate representation built from
 * the analyzed AST. Backends (React, Node, Postgres) read from the IR
 * rather than the raw AST so the lowering pass acts as a single source
 * of truth for the cross-cutting decisions (state vs derived, fetch
 * bridge generation, schema → SQL types, etc.).
 *
 * The IR is intentionally minimal: it's enough to drive a working MVP
 * stack, not a fully-featured production app. Edge cases (transactions
 * with isolation levels, complex pattern matching, sophisticated UI
 * layouts) are emitted as best-effort with TODO markers.
 */

import type {
  ActionDecl,
  Block,
  ColumnDecl,
  ComponentDecl,
  ElementDecl,
  EndpointDecl,
  Expr,
  Stmt,
  TableDecl,
  TypeRef,
} from "../ast/index.js";
import type { AnalysisResult, SymbolDecl } from "../semantic/index.js";

/** Top-level IR object — one per Modra source file. */
export interface ProjectIR {
  /** Module identifier (file stem without extension). */
  name: string;
  /** Original `.modra` path for source attribution. */
  sourceFile: string;
  /** Frontend pieces (React components / hooks / actions). */
  client: ClientModuleIR;
  /** Backend pieces (Express endpoints, transactional handlers). */
  server: ServerModuleIR;
  /** Database schema (tables + DDL). */
  schema: SchemaModuleIR;
  /** Bridge metadata (which endpoints the client calls via `Server.X`). */
  bridge: BridgeModuleIR;
  /** Diagnostics surfaced while lowering. */
  diagnostics: { severity: "warning" | "info"; message: string }[];
}

// ─── Client-side IR ─────────────────────────────────────────
export interface ClientModuleIR {
  styles: StyleIR[];
  components: ComponentIR[];
  /** Free-floating client state (file-level reactive declarations). */
  state: StateDeclIR[];
  /** Actions exported as user-callable functions. */
  actions: ActionIR[];
  /** Things that go directly into the page entrypoint (`Main` Action). */
  entry: ActionIR | null;
}

export interface StyleIR {
  name: string;
  base: string | null; // `from AppleGlass` extends another style
  rules: { property: string; value: string }[];
}

export interface ComponentIR {
  name: string;
  params: { name: string; tsType: string }[];
  /** Local state declared inside the component (`Number: X <- 0`). */
  localState: StateDeclIR[];
  /** Event wires inside the component (e.g. `Click -> Handler`). */
  eventHandlers: EventHandlerIR[];
  /** UI tree (lowered from element-decl tree). */
  ui: UINode | null;
}

/** Reactive declaration — produces a hook in the React emitter. */
export interface StateDeclIR {
  name: string;
  tsType: string;
  /** Source JS expression for the initial value. */
  initExpr: string;
  /** Names of other state symbols this depends on (drives memo deps). */
  reads: string[];
  /** True if this can change at runtime (-> useState); false if constant. */
  isReactive: boolean;
}

export interface ActionIR {
  name: string;
  params: { name: string; tsType: string }[];
  /** Lowered JS statements. */
  body: string[];
  /** Names of `Server.X` endpoints called from this action. */
  serverCalls: string[];
  /** Source UI sub-tree (when action contains a `Window:` etc.). */
  ui: UINode | null;
}

export interface EventHandlerIR {
  /** e.g. "Click", "Submit". */
  event: string;
  /** Bound JS expression — usually the action's identifier. */
  handlerExpr: string;
  /** UI element this handler is attached to (best-effort). */
  attachedTo: string | null;
}

/** UI tree node — the simplest possible JSX-like form. */
export type UINode =
  | { kind: "Element"; tag: string; props: UIProp[]; children: UINode[] }
  | { kind: "Text"; value: string } // static literal text
  | { kind: "Interp"; expr: string } // `{state}` injection
  | { kind: "If"; condition: string; then: UINode; otherwise: UINode | null }
  | { kind: "ForEach"; iterable: string; binding: string; body: UINode };

export interface UIProp {
  name: string;
  /** Either `value` (static JSON-serialisable) or `expr` (JS expression). */
  value?: string;
  expr?: string;
  /** "two-way" props become `value=`/`onChange=` pairs in React. */
  twoWay?: boolean;
}

// ─── Server-side IR ─────────────────────────────────────────
export interface ServerModuleIR {
  endpoints: EndpointIR[];
}

export interface EndpointIR {
  name: string;
  method: "GET" | "POST"; // POST by default; @@http directive can override
  /** URL path (`/api/<name>` by default). */
  path: string;
  params: { name: string; tsType: string }[];
  /** TypeScript return type. */
  returnType: string;
  /** Lowered JS statements (server-flavoured). */
  body: string[];
  /** Database side-effects (insert / select / update statements). */
  dbOps: DbOpIR[];
  /** Whether the body needs an inline Native bridge (Python etc.). */
  nativeBridges: NativeBridgeIR[];
}

export interface DbOpIR {
  /** SQL flavour (`insert`, `select`, `update`, `delete`). */
  op: "insert" | "select" | "update" | "delete";
  table: string;
  /** Column → JS expression for INSERTs / UPDATEs. */
  values: Record<string, string>;
  /** Where-clause expression (raw JS). */
  where?: string;
  /** Name of the variable storing the result (for chained reads). */
  bindResultTo?: string;
}

export interface NativeBridgeIR {
  /** Language name (Python, Go, etc.). */
  language: string;
  /** Variable names passed in. */
  inputs: string[];
  /** Variable names produced. */
  outputs: string[];
  /** Raw native source body. */
  body: string;
}

// ─── Schema IR ──────────────────────────────────────────────
export interface SchemaModuleIR {
  backend: string; // "Postgres" | "MySQL" | …
  tables: TableIR[];
}

export interface TableIR {
  name: string;
  columns: ColumnIR[];
}

export interface ColumnIR {
  name: string;
  sqlType: string;
  primary: boolean;
  unique: boolean;
  nullable: boolean;
  defaultExpr: string | null;
}

// ─── Bridge IR ──────────────────────────────────────────────
export interface BridgeModuleIR {
  /** Endpoints that need a client-side fetch wrapper. */
  endpoints: BridgeEndpointIR[];
}

export interface BridgeEndpointIR {
  name: string;
  path: string;
  method: "GET" | "POST";
  params: { name: string; tsType: string }[];
  returnType: string;
}

// ─────────────────────────────────────────────────────────────
//  Lowering: AST + Analysis → ProjectIR
// ─────────────────────────────────────────────────────────────

export function lower(analysis: AnalysisResult): ProjectIR {
  const name = inferModuleName(analysis.filePath);
  const ir: ProjectIR = {
    name,
    sourceFile: analysis.filePath,
    client: { styles: [], components: [], state: [], actions: [], entry: null },
    server: { endpoints: [] },
    schema: { backend: "Postgres", tables: [] },
    bridge: { endpoints: [] },
    diagnostics: [],
  };

  for (const decl of analysis.file.declarations) {
    switch (decl.kind) {
      case "StyleDecl":
        ir.client.styles.push(lowerStyle(decl));
        break;
      case "ComponentDecl":
        ir.client.components.push(lowerComponent(decl, analysis));
        break;
      case "EndpointDecl":
        ir.server.endpoints.push(lowerEndpoint(decl, analysis));
        ir.bridge.endpoints.push(lowerBridge(decl, analysis));
        break;
      case "ActionDecl":
        lowerAction(decl, analysis, ir);
        break;
      case "DatabaseDecl":
        ir.schema.backend = decl.backend.name;
        for (const t of decl.tables) {
          ir.schema.tables.push(lowerTable(t));
        }
        break;
      case "ElementDecl":
        // File-level reactive state.
        if (decl.name && decl.init) {
          ir.client.state.push(lowerStateDecl(decl, analysis));
        }
        break;
      case "TypeDecl":
      case "ErrorDecl":
        break;
    }
  }

  return ir;
}

function inferModuleName(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "module";
  return base.replace(/\.modra$/i, "").replace(/[^a-zA-Z0-9_]/g, "_");
}

// ─── Style ──────────────────────────────────────────────────
function lowerStyle(decl: import("../ast/index.js").StyleDecl): StyleIR {
  const rules: { property: string; value: string }[] = [];
  for (const item of decl.body) {
    if (item.kind === "ElementDecl" && item.label.name && item.init) {
      rules.push({
        property: item.label.name,
        value: exprToJs(item.init),
      });
    } else if (item.kind === "ElementDecl" && item.name && item.init) {
      // `Color: Primary <- "#ff6b6b"` style rule pattern
      rules.push({
        property: `${item.label.name}.${item.name.name}`,
        value: exprToJs(item.init),
      });
    }
  }
  return {
    name: decl.name.name,
    base: decl.base?.name ?? null,
    rules,
  };
}

// ─── Component ──────────────────────────────────────────────
function lowerComponent(decl: ComponentDecl, analysis: AnalysisResult): ComponentIR {
  const params = decl.params.map((p) => ({
    name: p.name.name,
    tsType: p.type ? typeRefToTs(p.type) : "any",
  }));
  const localState: StateDeclIR[] = [];
  const eventHandlers: EventHandlerIR[] = [];
  const ui = lowerBlockUI(decl.body, analysis, localState, eventHandlers);
  // Pull in auto-declared state from the component's scope (these come
  // from `InputField::Name` style two-way bindings).
  const compScope = analysis.resolution.getNodeScope(decl);
  if (compScope) {
    const declared = new Set(localState.map((s) => s.name));
    for (const sym of compScope.allSymbols()) {
      if (sym.kind !== "state") continue;
      if (declared.has(sym.name)) continue;
      // Best-effort initial value: empty string for auto-declared input state.
      localState.push({
        name: sym.name,
        tsType: "string",
        initExpr: '""',
        reads: [],
        isReactive: true,
      });
    }
  }
  return {
    name: decl.name.name,
    params,
    localState,
    eventHandlers,
    ui,
  };
}

/** Walk a Block looking for the first ElementDecl that represents the
 *  top-level UI tree; emit any reactive / state decls as we go. */
function lowerBlockUI(
  block: Block,
  analysis: AnalysisResult,
  state: StateDeclIR[],
  handlers: EventHandlerIR[],
): UINode | null {
  let root: UINode | null = null;
  const children: UINode[] = [];
  for (const item of block.items) {
    if (item.kind === "ElementDecl") {
      if (item.name && item.init && !item.body) {
        // State declaration: `Number: Count <- 0`.
        state.push(lowerStateDecl(item, analysis));
        continue;
      }
      const node = elementToUI(item, analysis, state, handlers);
      if (node) {
        if (!root) root = node;
        else children.push(node);
      }
    } else if (item.kind === "EventWireStmt") {
      handlers.push({
        event: item.event.kind === "Identifier" ? item.event.name : "Event",
        handlerExpr:
          item.handler.kind === "Identifier"
            ? item.handler.name
            : `() => { ${item.handler.kind === "Block" ? "/* todo */" : exprToJs(item.handler)} }`,
        attachedTo: null,
      });
    } else if (item.kind === "ExpressionStmt") {
      // Heuristic: a bare expression at component scope might be a UI fragment
      const text = exprToJs(item.expression);
      if (text) children.push({ kind: "Interp", expr: text });
    }
  }
  if (root && root.kind === "Element" && children.length > 0) {
    root.children.push(...children);
  } else if (!root && children.length === 1) {
    root = children[0]!;
  } else if (!root && children.length > 1) {
    root = { kind: "Element", tag: "div", props: [], children };
  }
  return root;
}

function elementToUI(
  decl: ElementDecl,
  analysis: AnalysisResult,
  state: StateDeclIR[],
  handlers: EventHandlerIR[],
): UINode | null {
  const tag = uiTagFor(decl);
  const split = decl.attrs ? splitAttrs(decl.attrs.entries) : { props: [], children: [] };
  const props: UIProp[] = split.props;
  const children: UINode[] = [...split.children];
  void handlers;

  // Positional content / nested children.
  if (decl.init) {
    if (decl.init.kind === "StringLit") {
      children.push({ kind: "Text", value: decl.init.value });
    } else if (decl.init.kind === "InterpolatedStringLit") {
      for (const p of decl.init.parts) {
        if (p.kind === "StringChunkPart") children.push({ kind: "Text", value: p.value });
        else children.push({ kind: "Interp", expr: exprToJs(p) });
      }
    } else {
      children.push({ kind: "Interp", expr: exprToJs(decl.init) });
    }
  }
  if (decl.body) {
    if (decl.body.kind === "Block") {
      for (const item of decl.body.items) {
        if (item.kind === "ElementDecl") {
          if (item.name && item.init && !item.body) {
            state.push(lowerStateDecl(item, analysis));
            continue;
          }
          const ch = elementToUI(item, analysis, state, handlers);
          if (ch) children.push(ch);
        } else if (item.kind === "ForEachStmt") {
          // forEach inside UI -> .map() in React
          const inner = lowerForEachUI(item, analysis, state, handlers);
          if (inner) children.push(inner);
        } else if (item.kind === "IfStmt") {
          const node = lowerIfUI(item, analysis, state, handlers);
          if (node) children.push(node);
        }
      }
    }
  }

  if (children.length === 0 && props.length === 0) return null;
  return { kind: "Element", tag, props, children };
}

function lowerForEachUI(
  stmt: import("../ast/index.js").ForEachStmt,
  analysis: AnalysisResult,
  state: StateDeclIR[],
  handlers: EventHandlerIR[],
): UINode | null {
  const inner = lowerBlockUI(stmt.body, analysis, state, handlers);
  if (!inner) return null;
  return {
    kind: "ForEach",
    iterable: exprToJs(stmt.iterable),
    binding: stmt.binding.name,
    body: inner,
  };
}

function lowerIfUI(
  stmt: import("../ast/index.js").IfStmt,
  analysis: AnalysisResult,
  state: StateDeclIR[],
  handlers: EventHandlerIR[],
): UINode | null {
  const first = stmt.branches[0];
  if (!first || !first.condition) return null;
  const thenNode = lowerBlockUI(first.body, analysis, state, handlers);
  const elseBranch = stmt.branches.find((b) => b.condition === null);
  const elseNode = elseBranch ? lowerBlockUI(elseBranch.body, analysis, state, handlers) : null;
  if (!thenNode) return null;
  return { kind: "If", condition: exprToJs(first.condition), then: thenNode, otherwise: elseNode };
}

/**
 * Modra's attribute list inside a parent element actually contains a
 * mix of:
 *   - real props (placeholder: "...", style: BaseTheme)
 *   - event wires (Click -> Handler)
 *   - nested child elements (InputField::Email)
 *   - positional content (Text body, Submit button)
 *
 * `splitAttrs` partitions them. Subsequent attributes belonging to the
 * same nested element (e.g. `InputField::Email placeholder: "..."`) are
 * merged into that element's props until the next nested-element key.
 */
function splitAttrs(entries: import("../ast/index.js").Attribute[]): {
  props: UIProp[];
  children: UINode[];
} {
  const props: UIProp[] = [];
  const children: UINode[] = [];
  let openChild: { node: UINode; tag: string } | null = null;

  const flush = (): void => {
    if (openChild) {
      children.push(openChild.node);
      openChild = null;
    }
  };

  for (const a of entries) {
    // Bind-target shorthand: `InputField::Name` ⇒ child input element.
    if (a.bindTarget && a.key) {
      flush();
      const tag = uiTagForName(a.key.name);
      openChild = {
        tag: a.key.name,
        node: {
          kind: "Element",
          tag,
          props: [
            {
              name: tag === "input" ? "value" : a.key.name.toLowerCase(),
              expr: a.bindTarget.name,
              twoWay: true,
            },
          ],
          children: [],
        },
      };
      continue;
    }
    // Event-wire shorthand: `Click -> Handler` ⇒ onClick on the
    // currently-open child (or parent if none).
    if (a.mode === "flag" && a.key && a.value && isEventName(a.key.name)) {
      const prop: UIProp = { name: `on${a.key.name}`, expr: exprToJs(a.value) };
      if (openChild) (openChild.node as { props: UIProp[] }).props.push(prop);
      else props.push(prop);
      continue;
    }
    // Positional / flag element (just `Submit` with no value) starts a
    // new child element.
    if (a.key && !a.value && !a.bindTarget) {
      const k = a.key.name;
      if (isKnownComponent(k)) {
        flush();
        openChild = {
          tag: k,
          node: {
            kind: "Element",
            tag: uiTagForName(k),
            props: [],
            children: [],
          },
        };
        continue;
      }
      // Otherwise treat as a true HTML flag prop.
      props.push({ name: k, value: "true" });
      continue;
    }
    // Regular key: value or key <- value.
    if (a.key && a.value) {
      const propName = a.key.name;
      const expr = exprToJs(a.value);
      const prop: UIProp = { name: propName, expr };
      if (openChild) (openChild.node as { props: UIProp[] }).props.push(prop);
      else props.push(prop);
      continue;
    }
    // Positional content (no key) ⇒ check for component-name identifier
    // first (Modra's `Submit` flag-style child), else inline text.
    if (!a.key && a.value) {
      if (a.value.kind === "Identifier" && isKnownComponent(a.value.name)) {
        flush();
        openChild = {
          tag: a.value.name,
          node: {
            kind: "Element",
            tag: uiTagForName(a.value.name),
            props: [],
            children: [],
          },
        };
        continue;
      }
      const tn = exprToInlineNode(a.value);
      if (openChild) (openChild.node as { children: UINode[] }).children.push(tn);
      else children.push(tn);
      continue;
    }
  }
  flush();
  return { props, children };
}

function isKnownComponent(name: string): boolean {
  return /^[A-Z]/.test(name) && [
    "InputField", "Submit", "Button", "Text", "Title", "Card", "Form",
    "Image", "Link", "Icon", "List", "Grid", "Row", "Column", "Container",
    "Spacer", "Window", "Header", "Toast", "Show",
  ].includes(name);
}

function isEventName(name: string): boolean {
  if (!/^[A-Z]/.test(name)) return false;
  return [
    "Click", "Submit", "Change", "Hover", "Focus", "Blur", "Input",
    "KeyDown", "KeyUp", "MouseEnter", "MouseLeave", "Touch",
  ].includes(name);
}

function uiTagForName(name: string): string {
  switch (name) {
    case "InputField":
      return "input";
    case "Submit":
    case "Button":
      return "button";
    case "Title":
      return "h1";
    case "Header":
      return "header";
    case "Text":
      return "p";
    case "Form":
      return "form";
    case "Image":
      return "img";
    case "Link":
      return "a";
    case "List":
      return "ul";
    case "Card":
    case "Show":
    case "Window":
    case "Container":
    case "Row":
    case "Column":
    case "Grid":
      return "div";
    case "Icon":
      return "span";
    default:
      return "div";
  }
}

function exprToInlineNode(expr: Expr): UINode {
  if (expr.kind === "StringLit") return { kind: "Text", value: expr.value };
  if (expr.kind === "InterpolatedStringLit") {
    // Build a sequence of Text + Interp nodes wrapped in a span
    const children: UINode[] = [];
    for (const p of expr.parts) {
      if (p.kind === "StringChunkPart") children.push({ kind: "Text", value: p.value });
      else children.push({ kind: "Interp", expr: exprToJs(p) });
    }
    return { kind: "Element", tag: "span", props: [], children };
  }
  return { kind: "Interp", expr: exprToJs(expr) };
}

/** Map Modra UI tags onto plain HTML / React equivalents. */
function uiTagFor(decl: ElementDecl): string {
  const lbl = decl.label.name;
  // Use the `base` (if any) as a hint over the label.
  const semantic = decl.base?.name ?? lbl;
  switch (semantic) {
    case "Window":
    case "Container":
      return "div";
    case "Title":
      return "h1";
    case "Header":
      return "header";
    case "Text":
      return "p";
    case "Image":
      return "img";
    case "Button":
    case "Submit":
      return "button";
    case "InputField":
      return "input";
    case "Form":
    case "form":
      return "form";
    case "Grid":
      return "div";
    case "Row":
      return "div";
    case "Column":
      return "div";
    case "Card":
      return "div";
    case "Link":
      return "a";
    case "List":
      return "ul";
    case "Icon":
      return "span";
    case "Show":
      return "div";
    default:
      return "div";
  }
}

// ─── State decl ─────────────────────────────────────────────
function lowerStateDecl(decl: ElementDecl, analysis: AnalysisResult): StateDeclIR {
  const tsType = typeRefToTs({
    kind: "TypeRef",
    name: decl.label,
    generics: decl.labelGenerics,
    optional: false,
    span: decl.label.span,
  });
  const initExpr = decl.init ? exprToJs(decl.init) : defaultValueForType(tsType);
  const reads: string[] = [];
  if (decl.name) {
    const sym = analysis.fileScope.lookupLocal(decl.name.name)
      ?? findInDescendants(analysis, decl.name.name);
    if (sym) {
      const reactiveNode = analysis.reactivity.nodes.find((n) => n.symbol === sym);
      if (reactiveNode) reads.push(...Array.from(reactiveNode.reads).map((r) => r.name));
    }
  }
  return {
    name: decl.name!.name,
    tsType,
    initExpr,
    reads,
    isReactive: true,
  };
}

function findInDescendants(analysis: AnalysisResult, name: string): SymbolDecl | null {
  for (const s of analysis.fileScope.allSymbols()) {
    if (s.name === name) return s;
  }
  return null;
}

// ─── Endpoint ───────────────────────────────────────────────
function lowerEndpoint(decl: EndpointDecl, _analysis: AnalysisResult): EndpointIR {
  const params = decl.params.map((p) => ({
    name: p.name.name,
    tsType: p.type ? typeRefToTs(p.type) : "any",
  }));
  const dbOps: DbOpIR[] = [];
  const natives: NativeBridgeIR[] = [];
  const body = lowerStmts(decl.body.items, dbOps, natives);
  const returnType = decl.returnType ? typeRefToTs(decl.returnType) : "any";
  return {
    name: decl.name.name,
    method: "POST",
    path: `/api/${decl.name.name}`,
    params,
    returnType,
    body,
    dbOps,
    nativeBridges: natives,
  };
}

function lowerBridge(decl: EndpointDecl, _analysis: AnalysisResult): BridgeEndpointIR {
  return {
    name: decl.name.name,
    path: `/api/${decl.name.name}`,
    method: "POST",
    params: decl.params.map((p) => ({
      name: p.name.name,
      tsType: p.type ? typeRefToTs(p.type) : "any",
    })),
    returnType: decl.returnType ? typeRefToTs(decl.returnType) : "any",
  };
}

// ─── Action ─────────────────────────────────────────────────
function lowerAction(decl: ActionDecl, analysis: AnalysisResult, ir: ProjectIR): void {
  const state: StateDeclIR[] = [];
  const handlers: EventHandlerIR[] = [];
  const ui = lowerBlockUI(decl.body, analysis, state, handlers);
  const serverCalls = findServerCalls(decl);
  const body = lowerStmts(decl.body.items, [], []);
  const action: ActionIR = {
    name: decl.name.name,
    params: decl.params.map((p) => ({
      name: p.name.name,
      tsType: p.type ? typeRefToTs(p.type) : "any",
    })),
    body,
    serverCalls,
    ui,
  };
  if (decl.name.name === "Main") {
    ir.client.entry = action;
    // Merge entry-local state into client.state
    for (const s of state) ir.client.state.push(s);
  } else {
    ir.client.actions.push(action);
  }
}

function findServerCalls(decl: ActionDecl): string[] {
  const out: string[] = [];
  walkNode(decl.body, (n) => {
    if (
      n.kind === "Call" &&
      n.callee.kind === "Member" &&
      n.callee.object.kind === "Identifier" &&
      n.callee.object.name === "Server" &&
      n.callee.property.kind === "Identifier"
    ) {
      out.push(n.callee.property.name);
    }
  });
  return out;
}

function walkNode(node: { kind: string } | null | undefined, fn: (n: any) => void): void {
  if (!node) return;
  fn(node);
  const obj = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (key === "kind" || key === "span") continue;
    const v = obj[key];
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && "kind" in item) walkNode(item as never, fn);
      }
    } else if (v && typeof v === "object" && "kind" in v) {
      walkNode(v as never, fn);
    }
  }
}

// ─── Table ──────────────────────────────────────────────────
function lowerTable(t: TableDecl): TableIR {
  return {
    name: t.name.name,
    columns: t.columns.map(lowerColumn),
  };
}

function lowerColumn(col: ColumnDecl): ColumnIR {
  const primary = col.decorators.some((d) => d.name.name === "Primary");
  const unique = col.decorators.some((d) => d.name.name === "Unique");
  const nullable = col.type.optional;
  return {
    name: col.name.name,
    sqlType: typeRefToSql(col.type),
    primary,
    unique,
    nullable,
    defaultExpr: col.init ? exprToJs(col.init) : null,
  };
}

// ─── Statement / Expression lowering ────────────────────────
function lowerStmts(
  items: (Stmt | ElementDecl | import("../ast/index.js").TopLevelDecl)[],
  dbOps: DbOpIR[],
  natives: NativeBridgeIR[],
): string[] {
  const out: string[] = [];
  for (const item of items) {
    const lines = lowerStmt(item, dbOps, natives);
    out.push(...lines);
  }
  return out;
}

function lowerStmt(
  item: Stmt | ElementDecl | import("../ast/index.js").TopLevelDecl,
  dbOps: DbOpIR[],
  natives: NativeBridgeIR[],
): string[] {
  switch (item.kind) {
    case "ExpressionStmt": {
      const e = item.expression;
      if (e.kind === "NativeBridge") {
        natives.push({
          language: e.language.name,
          inputs: e.inputs.map((i) => i.name),
          outputs: e.outputs.map((o) => o.name),
          body: e.body,
        });
        const inputsObj =
          "{ " + e.inputs.map((i) => i.name).join(", ") + " }";
        const outDest =
          e.outputs.length === 1
            ? `let { ${e.outputs[0]!.name} }`
            : `let { ${e.outputs.map((o) => o.name).join(", ")} }`;
        return [
          `${outDest} = run${e.language.name}(${JSON.stringify(e.body)}, ${inputsObj});`,
        ];
      }
      return [`${exprToJs(e)};`];
    }
    case "ElementDecl": {
      // Inside an Endpoint body, `Record: NewUser <- DB.Users.Insert(...)`
      // produces a DB op when the init is a DB-style call.
      if (item.name && item.init) {
        const dbOp = parseDbOp(item.init, item.name.name);
        if (dbOp) {
          dbOps.push(dbOp);
          return [`const ${item.name.name} = await ${exprToJs(item.init)};`];
        }
        return [`const ${item.name.name} = ${exprToJs(item.init)};`];
      }
      if (item.label.name === "Log" && item.init) {
        return [`console.log(${exprToJs(item.init)});`];
      }
      return [];
    }
    case "ReturnStmt":
      return item.value ? [`return ${exprToJs(item.value)};`] : ["return;"];
    case "ThrowStmt":
      return [`throw ${exprToJs(item.value)};`];
    case "IfStmt": {
      const out: string[] = [];
      let first = true;
      for (const b of item.branches) {
        if (b.condition) {
          out.push(`${first ? "if" : "else if"} (${exprToJs(b.condition)}) {`);
        } else {
          out.push("else {");
        }
        for (const inner of lowerStmts(b.body.items, dbOps, natives)) {
          out.push("  " + inner);
        }
        out.push("}");
        first = false;
      }
      return out;
    }
    case "WhileStmt": {
      const out: string[] = [`while (${exprToJs(item.condition)}) {`];
      for (const inner of lowerStmts(item.body.items, dbOps, natives)) out.push("  " + inner);
      out.push("}");
      return out;
    }
    case "ForEachStmt": {
      const out: string[] = [`for (const ${item.binding.name} of ${exprToJs(item.iterable)}) {`];
      for (const inner of lowerStmts(item.body.items, dbOps, natives)) out.push("  " + inner);
      out.push("}");
      return out;
    }
    case "ReactiveAssignStmt":
      return [`set${capitalize(exprToJs(item.target))}(${exprToJs(item.value)});`];
    case "RequireStmt":
      return [`if (!(${exprToJs(item.condition)})) throw new Error("Require failed");`];
    case "AssertStmt":
      return [`console.assert(${exprToJs(item.condition)});`];
    default:
      return [];
  }
}

/** If the init is a `DB.<Table>.<Op>(...)` call, lift it to a DbOp. */
function parseDbOp(expr: Expr, resultName: string): DbOpIR | null {
  if (expr.kind !== "Call") return null;
  const callee = expr.callee;
  if (callee.kind !== "Member") return null;
  if (callee.object.kind !== "Member") return null;
  if (callee.object.object.kind !== "Identifier") return null;
  if (callee.object.object.name !== "DB") return null;
  const tableId = callee.object.property;
  const opId = callee.property;
  if (tableId.kind !== "Identifier" || opId.kind !== "Identifier") return null;
  const opName = opId.name.toLowerCase();
  if (opName !== "insert" && opName !== "select" && opName !== "update" && opName !== "delete") {
    return null;
  }
  const values: Record<string, string> = {};
  for (const arg of expr.args) {
    if (arg.name) values[arg.name.name] = exprToJs(arg.value);
  }
  return {
    op: opName,
    table: tableId.name,
    values,
    bindResultTo: resultName,
  };
}

// ─── Expression → JS string ─────────────────────────────────
export function exprToJs(expr: Expr): string {
  switch (expr.kind) {
    case "NumberLit":
      return String(expr.value);
    case "StringLit":
      return JSON.stringify(expr.value);
    case "BoolLit":
      return expr.value ? "true" : "false";
    case "NoneLit":
      return "null";
    case "HexColorLit":
      return JSON.stringify(expr.value);
    case "Identifier":
      return mapBuiltinName(expr.name);
    case "InterpolatedStringLit": {
      const parts = expr.parts.map((p) =>
        p.kind === "StringChunkPart"
          ? p.value.replace(/`/g, "\\`")
          : `\${${exprToJs(p)}}`,
      );
      return "`" + parts.join("") + "`";
    }
    case "DottedExpr":
      return expr.parts.map((p) => mapBuiltinName(p.name)).join(".");
    case "Member":
      return `${exprToJs(expr.object)}.${expr.property.name}`;
    case "Call": {
      // Named-argument calls become a single object-literal argument.
      const hasNamed = expr.args.some((a) => a.name !== null);
      const calleeJs = exprToJs(expr.callee);
      const argsJs = hasNamed
        ? "{ " +
          expr.args
            .map((a) =>
              a.name
                ? `${a.name.name}: ${exprToJs(a.value)}`
                : exprToJs(a.value),
            )
            .join(", ") +
          " }"
        : expr.args.map((a) => exprToJs(a.value)).join(", ");
      // Common JS pitfall: `Error("…")` must be `new Error("…")`.
      if (calleeJs === "Error") return `new Error(${argsJs})`;
      const wrap = hasNamed ? `(${argsJs})` : `(${argsJs})`;
      return `${calleeJs}${wrap}`;
    }
    case "Index":
      return `${exprToJs(expr.object)}[${exprToJs(expr.index)}]`;
    case "Unary":
      return `${jsUnary(expr.operator)}${exprToJs(expr.operand)}`;
    case "Binary":
      return `${exprToJs(expr.left)} ${jsBinary(expr.operator)} ${exprToJs(expr.right)}`;
    case "Conditional":
      return `(${exprToJs(expr.condition)} ? ${exprToJs(expr.consequent)} : ${expr.alternate ? exprToJs(expr.alternate) : "null"})`;
    case "ArrayLit":
      return `[${expr.items.map(exprToJs).join(", ")}]`;
    case "ObjectLit":
      return `{ ${expr.entries.map((e) => `${e.key.name}: ${exprToJs(e.value)}`).join(", ")} }`;
    case "Injection":
      return exprToJs(expr.expression);
    case "NativeBridge":
      return `/* native:${expr.language.name} */`;
    case "ParenExpr":
      return `(${exprToJs(expr.expression)})`;
    case "ErrorExpr":
      return "/* error */";
  }
}

function jsBinary(op: string): string {
  switch (op) {
    case "and":
      return "&&";
    case "or":
      return "||";
    case "is":
    case "==":
      return "===";
    case "is not":
    case "!=":
      return "!==";
    case "|":
      return "/*pipe*/";
    default:
      return op;
  }
}
function jsUnary(op: string): string {
  if (op === "not") return "!";
  return op;
}

// ─── TypeRef → TS string ────────────────────────────────────
function typeRefToTs(t: TypeRef): string {
  const base = baseTsName(t.name.name, t.generics);
  return t.optional ? `${base} | null` : base;
}
function baseTsName(name: string, generics: TypeRef[]): string {
  switch (name) {
    case "Number":
    case "Int":
    case "Float":
    case "Decimal":
      return "number";
    case "String":
    case "Text":
      return "string";
    case "Bool":
    case "Boolean":
      return "boolean";
    case "Color":
      return "string";
    case "DateTime":
    case "Date":
    case "Time":
      return "Date";
    case "None":
      return "null";
    case "Any":
    case "Object":
      return "any";
    case "Array":
    case "List":
      return `Array<${generics[0] ? typeRefToTs(generics[0]) : "any"}>`;
    case "Map":
    case "Dict":
      return `Record<${generics[0] ? typeRefToTs(generics[0]) : "string"}, ${generics[1] ? typeRefToTs(generics[1]) : "any"}>`;
    case "Option":
    case "Maybe":
      return `${generics[0] ? typeRefToTs(generics[0]) : "any"} | null`;
    case "Record":
      return "any"; // emitter doesn't yet model row types
    default:
      return name;
  }
}

function typeRefToSql(t: TypeRef): string {
  const base = sqlBase(t.name.name, t.generics);
  return t.optional ? base : `${base} NOT NULL`;
}
function sqlBase(name: string, generics: TypeRef[]): string {
  switch (name) {
    case "Number":
    case "Int":
      return "INTEGER";
    case "Float":
    case "Decimal":
      return "DOUBLE PRECISION";
    case "String":
    case "Text":
      return "TEXT";
    case "Bool":
    case "Boolean":
      return "BOOLEAN";
    case "DateTime":
      return "TIMESTAMPTZ";
    case "Date":
      return "DATE";
    case "Time":
      return "TIME";
    case "Array":
    case "List":
      return `${sqlBase(generics[0]?.name.name ?? "Text", generics[0]?.generics ?? [])}[]`;
    default:
      return "TEXT";
  }
}

function defaultValueForType(tsType: string): string {
  switch (tsType) {
    case "number":
      return "0";
    case "string":
      return '""';
    case "boolean":
      return "false";
    default:
      if (tsType.startsWith("Array")) return "[]";
      return "null";
  }
}

function capitalize(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Translate Modra magic identifiers into their generated-JS equivalent. */
function mapBuiltinName(name: string): string {
  switch (name) {
    case "DB":
      return "db";
    case "UUID":
      return "uuid";
    case "Now":
      return "now";
    case "__module__":
    case "__file__":
      return "import.meta.url";
    case "__line__":
      return "0";
    case "Server":
      return "Server";
    case "Client":
      return "Client";
    case "true":
    case "false":
    case "none":
      return name === "none" ? "null" : name;
    default:
      return name;
  }
}
