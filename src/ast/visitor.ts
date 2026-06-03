/**
 * Generic AST walker.
 *
 * `walk(node, visit)` performs a depth-first pre-order traversal of any
 * AST node, calling `visit(child, parent)` once per node. Return `false`
 * from `visit` to stop descending into the current subtree (still
 * traverses siblings). Return `void` / `true` to continue.
 *
 * The walker recognises every NodeKind defined in nodes.ts; new kinds
 * MUST be added to the switch below (TypeScript will flag the omission).
 */

import type { AnyNode } from "./nodes.js";

export type VisitFn = (node: AnyNode, parent: AnyNode | null) => boolean | void;

export function walk(root: AnyNode, visit: VisitFn): void {
  walkImpl(root, null, visit);
}

function walkImpl(node: AnyNode, parent: AnyNode | null, visit: VisitFn): void {
  const result = visit(node, parent);
  if (result === false) return;
  for (const child of childrenOf(node)) {
    walkImpl(child, node, visit);
  }
}

/**
 * Yields all direct child AST nodes of `node` in syntactic order.
 * Pure function — no side effects. Adding a new node kind requires a
 * new branch here.
 */
export function* childrenOf(node: AnyNode): Iterable<AnyNode> {
  switch (node.kind) {
    case "File":
      yield* node.directives;
      yield* node.usings;
      yield* node.declarations;
      return;

    case "Directive":
      yield node.name;
      yield* node.args;
      if (node.value) yield node.value;
      return;

    case "UsingDecl":
      yield node.path;
      if (node.alias) yield node.alias;
      return;

    case "DottedName":
      yield* node.parts;
      return;

    case "TypeRef":
      yield node.name;
      yield* node.generics;
      return;

    case "Decorator":
      yield node.name;
      yield* node.args;
      return;

    case "Parameter":
      yield node.name;
      if (node.type) yield node.type;
      if (node.defaultValue) yield node.defaultValue;
      return;

    case "Attribute":
      if (node.key) yield node.key;
      if (node.value) yield node.value;
      if (node.bindTarget) yield node.bindTarget;
      return;

    case "AttrList":
      yield* node.entries;
      return;

    case "StyleDecl":
      yield* node.directives;
      yield* node.decorators;
      yield node.name;
      if (node.base) yield node.base;
      yield* node.body;
      return;

    case "ComponentDecl":
      yield* node.directives;
      yield* node.decorators;
      yield node.name;
      yield* node.params;
      yield* node.composes;
      if (node.wraps) yield node.wraps;
      if (node.init) yield node.init;
      yield* node.emits;
      yield* node.consumes;
      yield node.body;
      return;

    case "EndpointDecl":
      yield* node.directives;
      yield* node.decorators;
      yield node.name;
      yield* node.params;
      if (node.returnType) yield node.returnType;
      yield node.body;
      return;

    case "ActionDecl":
      yield* node.directives;
      yield* node.decorators;
      yield node.name;
      yield* node.params;
      yield* node.emits;
      yield* node.consumes;
      yield node.body;
      return;

    case "DatabaseDecl":
      yield* node.directives;
      yield* node.decorators;
      yield node.backend;
      yield* node.tables;
      return;

    case "TableDecl":
      yield* node.decorators;
      yield node.name;
      yield* node.columns;
      return;

    case "ColumnDecl":
      yield* node.decorators;
      yield node.type;
      yield node.name;
      if (node.init) yield node.init;
      return;

    case "TypeDecl":
      yield* node.directives;
      yield* node.decorators;
      yield node.name;
      yield node.alias;
      return;

    case "ElementDecl":
      yield* node.directives;
      yield* node.decorators;
      yield node.label;
      yield* node.labelGenerics;
      if (node.name) yield node.name;
      if (node.base) yield node.base;
      if (node.attrs) yield node.attrs;
      if (node.init) yield node.init;
      if (node.body) yield node.body;
      return;

    case "ErrorDecl":
    case "ErrorStmt":
    case "ErrorExpr":
    case "BreakStmt":
    case "ContinueStmt":
    case "NoneLit":
      return;

    case "Block":
      yield* node.items;
      return;

    case "IfStmt":
      yield* node.branches;
      return;

    case "IfBranch":
      if (node.condition) yield node.condition;
      yield node.body;
      return;

    case "WhileStmt":
      yield node.condition;
      yield node.body;
      return;

    case "ForEachStmt":
      yield node.iterable;
      yield node.binding;
      yield node.body;
      return;

    case "LoopStmt":
      yield node.body;
      return;

    case "RepeatStmt":
      yield node.count;
      yield node.body;
      return;

    case "MatchStmt":
      yield node.scrutinee;
      yield* node.cases;
      return;

    case "MatchCase":
      if (node.pattern) yield node.pattern;
      yield node.body;
      return;

    case "AttemptStmt":
      yield node.body;
      if (node.recoverBinding) yield node.recoverBinding;
      if (node.recoverBody) yield node.recoverBody;
      if (node.ensureBody) yield node.ensureBody;
      return;

    case "TransactionStmt":
    case "ParallelStmt":
    case "SequenceStmt":
      yield node.body;
      return;

    case "EventWireStmt":
      yield node.event;
      yield node.handler;
      return;

    case "BindStmt":
      yield node.element;
      yield node.target;
      if (node.attrs) yield node.attrs;
      return;

    case "ApplyEffectStmt":
      yield node.target;
      yield node.effect;
      return;

    case "ReactiveAssignStmt":
      yield node.target;
      yield node.value;
      return;

    case "SyncStmt":
      yield node.left;
      yield node.right;
      return;

    case "ReturnStmt":
    case "YieldStmt":
      if (node.value) yield node.value;
      return;

    case "ThrowStmt":
      yield node.value;
      return;

    case "RequireStmt":
    case "AssertStmt":
    case "ExpectStmt":
      yield node.condition;
      return;

    case "ExpressionStmt":
      yield node.expression;
      return;

    // ─── Expressions ─────────────────────────────────────────
    case "Identifier":
    case "NumberLit":
    case "StringLit":
    case "BoolLit":
    case "HexColorLit":
    case "StringChunkPart":
      return;

    case "InterpolatedStringLit":
      yield* node.parts;
      return;

    case "DottedExpr":
      yield* node.parts;
      return;

    case "Member":
      yield node.object;
      yield node.property;
      return;

    case "Call":
      yield node.callee;
      yield* node.args;
      return;

    case "CallArg":
      if (node.name) yield node.name;
      yield node.value;
      return;

    case "Index":
      yield node.object;
      yield node.index;
      return;

    case "Unary":
      yield node.operand;
      return;

    case "Binary":
      yield node.left;
      yield node.right;
      return;

    case "Conditional":
      yield node.condition;
      yield node.consequent;
      if (node.alternate) yield node.alternate;
      return;

    case "ArrayLit":
      yield* node.items;
      return;

    case "ObjectLit":
      yield* node.entries;
      return;

    case "ObjectEntry":
      yield node.key;
      yield node.value;
      return;

    case "Injection":
      yield node.expression;
      return;

    case "NativeBridge":
      yield node.language;
      yield* node.inputs;
      yield* node.outputs;
      return;

    case "ParenExpr":
      yield node.expression;
      return;
  }
}

/** Convenience: collect every node of a given kind in `root`. */
export function findAll<K extends AnyNode["kind"]>(
  root: AnyNode,
  kind: K,
): Extract<AnyNode, { kind: K }>[] {
  const out: Extract<AnyNode, { kind: K }>[] = [];
  walk(root, (n) => {
    if (n.kind === kind) {
      out.push(n as Extract<AnyNode, { kind: K }>);
    }
  });
  return out;
}

/** Convenience: first node of a given kind (depth-first), or null. */
export function findFirst<K extends AnyNode["kind"]>(
  root: AnyNode,
  kind: K,
): Extract<AnyNode, { kind: K }> | null {
  let found: Extract<AnyNode, { kind: K }> | null = null;
  walk(root, (n) => {
    if (found) return false;
    if (n.kind === kind) {
      found = n as Extract<AnyNode, { kind: K }>;
      return false;
    }
    return;
  });
  return found;
}
