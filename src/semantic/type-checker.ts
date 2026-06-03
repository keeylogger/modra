/**
 * Type inference and checking.
 *
 * The checker is bidirectional but biased toward inference: every
 * expression returns a `Type`, and the result is stored in a
 * `WeakMap<Expr, Type>`. Annotations (parameter types, column types,
 * Type aliases) act as hard constraints; mismatches yield MOD-S0xx
 * diagnostics. Untyped declarations (`Number: X <- 0`) get their
 * type from the literal `Type:` label on the left of `:`.
 *
 * The checker is intentionally lenient: missing types fall back to
 * `TAny`, which neither emits errors nor narrows downstream
 * inferences. Phase 3 emphasises useful coverage over soundness.
 */

import type {
  AnyNode,
  Block,
  ComponentDecl,
  ElementDecl,
  EndpointDecl,
  ActionDecl,
  Expr,
  Identifier,
  Parameter,
  StyleDecl,
  TypeDecl,
  FileNode,
} from "../ast/index.js";
import type { DiagnosticCollector } from "../utils/diagnostics.js";
import type { Resolver } from "./resolver.js";
import type { SymbolDecl } from "./symbols.js";
import {
  describeType,
  fromTypeRef,
  isAssignable,
  TAny,
  TBool,
  TColor,
  TDateTime,
  TError,
  TNone,
  TNumber,
  TString,
  tArray,
  tFunction,
  tObject,
  tRef,
  type Type,
} from "./types.js";

export class TypeChecker {
  private readonly typeAliases = new Map<string, Type>();
  private readonly exprTypes = new WeakMap<AnyNode, Type>();
  private readonly diag: DiagnosticCollector;
  private readonly resolver: Resolver;
  private readonly filePath: string;

  constructor(file: FileNode, resolver: Resolver, diag: DiagnosticCollector, filePath: string) {
    this.resolver = resolver;
    this.diag = diag;
    this.filePath = filePath;
    this.collectTypeAliases(file);
    this.assignTopLevel(file);
  }

  typeOf(node: AnyNode): Type {
    return this.exprTypes.get(node) ?? TAny;
  }

  // ─── Alias collection ───────────────────────────────────────
  private collectTypeAliases(file: FileNode): void {
    for (const decl of file.declarations) {
      if (decl.kind === "TypeDecl") {
        this.typeAliases.set(decl.name.name, fromTypeRef(decl.alias));
      }
    }
    // Also collect Table types as Record types.
    for (const decl of file.declarations) {
      if (decl.kind === "DatabaseDecl") {
        for (const t of decl.tables) {
          const cols = t.columns.map((c) => ({
            name: c.name.name,
            type: fromTypeRef(c.type),
          }));
          this.typeAliases.set(t.name.name, { kind: "Record", columns: cols });
        }
      }
    }
  }

  // ─── Top-level assignment ───────────────────────────────────
  private assignTopLevel(file: FileNode): void {
    for (const decl of file.declarations) {
      switch (decl.kind) {
        case "ComponentDecl":
          this.assignComponent(decl);
          break;
        case "EndpointDecl":
          this.assignEndpoint(decl);
          break;
        case "ActionDecl":
          this.assignAction(decl);
          break;
        case "StyleDecl":
          this.assignStyle(decl);
          break;
        case "ElementDecl":
          this.assignElementDecl(decl);
          break;
        case "TypeDecl":
          this.assignTypeDecl(decl);
          break;
        case "DatabaseDecl":
          // Tables already collected as Record aliases.
          break;
      }
    }
  }

  private assignTypeDecl(d: TypeDecl): void {
    const sym = this.resolver.fileScope.lookupLocal(d.name.name);
    if (sym) sym.type = this.resolveType(fromTypeRef(d.alias));
  }

  private assignComponent(c: ComponentDecl): void {
    const params = c.params.map((p) => this.assignParam(p));
    this.checkBlock(c.body);
    const sym = this.resolver.fileScope.lookupLocal(c.name.name);
    if (sym) sym.type = tFunction(params, tRef("UIElement"));
  }

  private assignEndpoint(e: EndpointDecl): void {
    const params = e.params.map((p) => this.assignParam(p));
    this.checkBlock(e.body);
    const ret = e.returnType ? this.resolveType(fromTypeRef(e.returnType)) : TAny;
    const sym = this.resolver.fileScope.lookupLocal(e.name.name);
    if (sym) sym.type = tFunction(params, ret);
  }

  private assignAction(a: ActionDecl): void {
    const params = a.params.map((p) => this.assignParam(p));
    this.checkBlock(a.body);
    const sym = this.resolver.fileScope.lookupLocal(a.name.name);
    if (sym) sym.type = tFunction(params, TAny);
  }

  private assignStyle(s: StyleDecl): void {
    for (const item of s.body) this.assignElementDecl(item);
  }

  private assignParam(p: Parameter): Type {
    const t = p.type ? this.resolveType(fromTypeRef(p.type)) : TAny;
    const sym = this.lookupSymbol(p.name);
    if (sym) sym.type = t;
    return t;
  }

  private assignElementDecl(decl: ElementDecl): void {
    const declaredType = this.typeFromLabel(decl);
    let inferredType: Type = TAny;
    if (decl.init) inferredType = this.checkExpression(decl.init);
    if (decl.body) {
      if (decl.body.kind === "Block") this.checkBlock(decl.body);
      else this.checkExpression(decl.body as Expr);
    }
    if (decl.attrs) {
      for (const a of decl.attrs.entries) {
        if (a.value) this.checkExpression(a.value as Expr);
      }
    }

    // If we have a declared type AND an init, verify assignability.
    if (decl.init && declaredType.kind !== "Any" && declaredType.kind !== "Reference") {
      if (!isAssignable(inferredType, declaredType)) {
        this.diag.error({
          code: "MOD-S010",
          message: `Cannot assign ${describeType(inferredType)} to ${describeType(declaredType)}.`,
          span: decl.init.span,
          file: this.filePath,
        });
      }
    }

    if (decl.name) {
      const sym = this.lookupSymbol(decl.name);
      if (sym) {
        // Prefer declared type if non-Any, otherwise inferred.
        sym.type = declaredType.kind === "Any" ? inferredType : declaredType;
      }
    }
  }

  private typeFromLabel(decl: ElementDecl): Type {
    // Synthesize a TypeRef from `decl.label` + `decl.labelGenerics` and
    // resolve.
    const ref: import("../ast/index.js").TypeRef = {
      kind: "TypeRef",
      name: decl.label,
      generics: decl.labelGenerics,
      optional: false,
      span: decl.label.span,
    };
    return this.resolveType(fromTypeRef(ref));
  }

  // ─── Resolve `Reference` types via aliases ──────────────────
  private resolveType(t: Type): Type {
    if (t.kind === "Reference") {
      return this.typeAliases.get(t.name) ?? t;
    }
    return t;
  }

  // ─── Blocks ─────────────────────────────────────────────────
  private checkBlock(block: Block): void {
    for (const item of block.items) {
      switch (item.kind) {
        case "ElementDecl":
          this.assignElementDecl(item);
          break;
        case "ComponentDecl":
          this.assignComponent(item);
          break;
        case "EndpointDecl":
          this.assignEndpoint(item);
          break;
        case "ActionDecl":
          this.assignAction(item);
          break;
        case "StyleDecl":
          this.assignStyle(item);
          break;
        case "IfStmt":
          for (const b of item.branches) {
            if (b.condition) this.checkExpression(b.condition);
            this.checkBlock(b.body);
          }
          break;
        case "WhileStmt":
          this.checkExpression(item.condition);
          this.checkBlock(item.body);
          break;
        case "ForEachStmt":
          this.checkExpression(item.iterable);
          this.checkBlock(item.body);
          break;
        case "LoopStmt":
          this.checkBlock(item.body);
          break;
        case "RepeatStmt":
          this.checkExpression(item.count);
          this.checkBlock(item.body);
          break;
        case "MatchStmt":
          this.checkExpression(item.scrutinee);
          for (const c of item.cases) {
            if (c.pattern) this.checkExpression(c.pattern);
            if (c.body.kind === "Block") this.checkBlock(c.body);
            else this.checkExpression(c.body);
          }
          break;
        case "AttemptStmt":
          this.checkBlock(item.body);
          if (item.recoverBody) this.checkBlock(item.recoverBody);
          if (item.ensureBody) this.checkBlock(item.ensureBody);
          break;
        case "TransactionStmt":
        case "ParallelStmt":
        case "SequenceStmt":
          this.checkBlock(item.body);
          break;
        case "EventWireStmt":
          this.checkExpression(item.event);
          if (item.handler.kind === "Block") this.checkBlock(item.handler);
          else this.checkExpression(item.handler);
          break;
        case "BindStmt":
          break;
        case "ApplyEffectStmt":
          this.checkExpression(item.target);
          this.checkExpression(item.effect);
          break;
        case "ReactiveAssignStmt":
          this.checkExpression(item.target);
          this.checkExpression(item.value);
          break;
        case "SyncStmt":
          this.checkExpression(item.left);
          this.checkExpression(item.right);
          break;
        case "ReturnStmt":
        case "YieldStmt":
          if (item.value) this.checkExpression(item.value);
          break;
        case "ThrowStmt":
          this.checkExpression(item.value);
          break;
        case "RequireStmt":
        case "AssertStmt":
        case "ExpectStmt":
          this.checkExpression(item.condition);
          break;
        case "ExpressionStmt":
          this.checkExpression(item.expression);
          break;
      }
    }
  }

  // ─── Expressions ────────────────────────────────────────────
  checkExpression(expr: Expr): Type {
    const cached = this.exprTypes.get(expr);
    if (cached) return cached;
    const t = this.inferExpression(expr);
    this.exprTypes.set(expr, t);
    return t;
  }

  private inferExpression(expr: Expr): Type {
    switch (expr.kind) {
      case "NumberLit":
        return TNumber;
      case "StringLit":
      case "InterpolatedStringLit":
        if (expr.kind === "InterpolatedStringLit") {
          for (const p of expr.parts) {
            if (p.kind !== "StringChunkPart") this.checkExpression(p);
          }
        }
        return TString;
      case "BoolLit":
        return TBool;
      case "NoneLit":
        return TNone;
      case "HexColorLit":
        return TColor;
      case "Identifier": {
        const sym = this.resolver.resolution.lookup(expr);
        if (sym) {
          // Built-in `Now`, `UUID` return special types
          if (sym.meta.builtin === true) {
            return this.builtinType(sym.name);
          }
          return sym.type ?? TAny;
        }
        return TAny;
      }
      case "DottedExpr":
        return TAny;
      case "Member": {
        const objT = this.resolveType(this.checkExpression(expr.object));
        if (objT.kind === "Object" || objT.kind === "Record") {
          const fields = objT.kind === "Object" ? objT.fields : objT.columns;
          const f = fields.find((f) => f.name === expr.property.name);
          if (f) return f.type;
        }
        return TAny;
      }
      case "Call": {
        const calleeT = this.resolveType(this.checkExpression(expr.callee));
        for (const a of expr.args) this.checkExpression(a.value);
        if (calleeT.kind === "Function") return calleeT.ret;
        return TAny;
      }
      case "Index": {
        const objT = this.resolveType(this.checkExpression(expr.object));
        this.checkExpression(expr.index);
        if (objT.kind === "Array") return objT.element;
        if (objT.kind === "Map") return objT.value;
        return TAny;
      }
      case "Unary": {
        const opT = this.checkExpression(expr.operand);
        if (expr.operator === "not" || expr.operator === "!") return TBool;
        return opT;
      }
      case "Binary": {
        const lt = this.checkExpression(expr.left);
        const rt = this.checkExpression(expr.right);
        return this.binaryResultType(expr.operator, lt, rt, expr);
      }
      case "Conditional": {
        this.checkExpression(expr.condition);
        const ct = this.checkExpression(expr.consequent);
        if (expr.alternate) this.checkExpression(expr.alternate);
        return ct;
      }
      case "ArrayLit": {
        if (expr.items.length === 0) return tArray(TAny);
        const inner = this.checkExpression(expr.items[0]!);
        for (let i = 1; i < expr.items.length; i++) this.checkExpression(expr.items[i]!);
        return tArray(inner);
      }
      case "ObjectLit": {
        const fields = expr.entries.map((e) => ({
          name: e.key.name,
          type: this.checkExpression(e.value),
        }));
        return tObject(fields);
      }
      case "Injection":
        return this.checkExpression(expr.expression);
      case "NativeBridge":
        return TAny;
      case "ParenExpr":
        return this.checkExpression(expr.expression);
      case "ErrorExpr":
        return TError;
    }
  }

  private binaryResultType(op: string, lt: Type, rt: Type, expr: Expr): Type {
    switch (op) {
      case "+":
        // String concatenation if either side is String; else Number.
        if (lt.kind === "String" || rt.kind === "String") return TString;
        return TNumber;
      case "-":
      case "*":
      case "/":
      case "%":
        return TNumber;
      case "==":
      case "!=":
      case "<":
      case "<=":
      case ">":
      case ">=":
      case "is":
      case "is not":
      case "in":
      case "notIn":
      case "contains":
      case "matches":
      case "between":
      case "within":
      case "outside":
        return TBool;
      case "and":
      case "or":
      case "xor":
      case "&&":
      case "||":
        return TBool;
      case "|":
        // Pipe: `value | transform` — result is transform's return type.
        if (rt.kind === "Function") return rt.ret;
        return TAny;
      default:
        return TAny;
    }
    void expr; // keep parameter for future use
  }

  private builtinType(name: string): Type {
    switch (name) {
      case "UUID":
        return tFunction([], TString);
      case "Now":
        return tFunction([], TDateTime);
      case "Log":
      case "Print":
        return tFunction([TAny], TNone);
      case "Error":
        return tFunction([TString], TAny);
      case "true":
      case "false":
        return TBool;
      case "none":
        return TNone;
      case "__module__":
      case "__file__":
        return TString;
      case "__line__":
        return TNumber;
      case "AuthToken":
        return tFunction([TAny], TString);
      default:
        return TAny;
    }
  }

  private lookupSymbol(id: Identifier): SymbolDecl | null {
    return this.resolver.resolution.lookup(id);
  }
}
