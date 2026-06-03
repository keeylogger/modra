/**
 * Modra Phase 2 — AST node definitions.
 *
 * Every node is a tagged discriminated union member sharing the
 * `NodeBase` shape: a string `kind` discriminator and a `SourceSpan`.
 * Downstream phases (semantic, emitters, formatter, LSP) switch on
 * `kind` with exhaustiveness checking.
 *
 * Node hierarchy:
 *
 *   FileNode
 *     ├── Directive*
 *     ├── UsingDecl*
 *     └── TopLevelDecl*  (Style | Component | Endpoint | Action |
 *                          Database | Type | ElementDecl)
 *
 *   Block.items = (ElementDecl | Stmt)*
 *
 *   Expr           = literals | Identifier | Member | Call | Index |
 *                    Unary | Binary | Conditional | ArrayLit |
 *                    ObjectLit | Injection | NativeBridge | ParenExpr
 *
 * `ElementDecl` is the unified "labelled body line" form
 * (Title: "Foo", Text: Logo (...), style: AppleGlass, Number: X <- 0).
 * Phase 3 classifies each ElementDecl by label and structure.
 */

import type { SourceSpan } from "../utils/source.js";

// ─────────────────────────────────────────────────────────────
//  Base
// ─────────────────────────────────────────────────────────────

export interface NodeBase {
  kind: string;
  span: SourceSpan;
}

// ─────────────────────────────────────────────────────────────
//  Identifiers and supporting nodes
// ─────────────────────────────────────────────────────────────

export interface Identifier extends NodeBase {
  kind: "Identifier";
  name: string;
}

export interface DottedName extends NodeBase {
  kind: "DottedName";
  parts: Identifier[];
}

export interface TypeRef extends NodeBase {
  kind: "TypeRef";
  /** The bare type name (e.g. "String", "Array", "EmailAddress"). */
  name: Identifier;
  /** Generic parameters: `Array<String>` -> [TypeRef(String)]. */
  generics: TypeRef[];
  /** Trailing `?` marks the type as optional. */
  optional: boolean;
}

export interface Decorator extends NodeBase {
  kind: "Decorator";
  name: Identifier;
  args: Expr[];
}

export interface Directive extends NodeBase {
  kind: "Directive";
  name: Identifier;
  /** Args inside parens: `@@experimental(featureA, featureB)`. */
  args: Expr[];
  /** Value after a colon: `@@target: Server`, `@@reactive: off`. */
  value: Expr | null;
}

export interface Parameter extends NodeBase {
  kind: "Parameter";
  name: Identifier;
  /** Declared type (null when inference applies). */
  type: TypeRef | null;
  /** Default value `name: Type = expr`. */
  defaultValue: Expr | null;
}

// ─────────────────────────────────────────────────────────────
//  Attributes (the `(a: x, b <- y, A::ref)` lists)
// ─────────────────────────────────────────────────────────────

export type AttributeMode = "static" | "reactive" | "two-way" | "flag";

export interface Attribute extends NodeBase {
  kind: "Attribute";
  /** `key:` or `key <- expr` left-hand side. For BindShorthand, this
   *  is the parent identifier (e.g. `InputField` in `InputField::Email`).
   *  For positional content (`Text("Hello")`), `key` is null. */
  key: Identifier | null;
  /** The right-hand side / value. For `flag` mode this is also null. */
  value: Expr | null;
  /** For `two-way` mode: the bound state identifier on the RHS. */
  bindTarget: Identifier | null;
  mode: AttributeMode;
}

export interface AttrList extends NodeBase {
  kind: "AttrList";
  entries: Attribute[];
}

// ─────────────────────────────────────────────────────────────
//  File root
// ─────────────────────────────────────────────────────────────

export interface FileNode extends NodeBase {
  kind: "File";
  /** Directives that appear at file top, before any using/declaration. */
  directives: Directive[];
  /** `using …` imports. */
  usings: UsingDecl[];
  /** Top-level declarations in source order. */
  declarations: TopLevelDecl[];
}

export interface UsingDecl extends NodeBase {
  kind: "UsingDecl";
  path: DottedName;
  alias: Identifier | null;
}

// ─────────────────────────────────────────────────────────────
//  Top-level declarations
// ─────────────────────────────────────────────────────────────

export type TopLevelDecl =
  | StyleDecl
  | ComponentDecl
  | EndpointDecl
  | ActionDecl
  | DatabaseDecl
  | TypeDecl
  | ElementDecl
  | ErrorDecl;

export interface StyleDecl extends NodeBase {
  kind: "StyleDecl";
  name: Identifier;
  base: Identifier | null;
  body: ElementDecl[];
  decorators: Decorator[];
  directives: Directive[];
}

export interface ComponentDecl extends NodeBase {
  kind: "ComponentDecl";
  name: Identifier;
  params: Parameter[];
  /** `composes A, B, C` — composition list. */
  composes: Identifier[];
  /** `wraps any` / `wraps T` — slot type. */
  wraps: Identifier | null;
  /** `init Refresh` — function to run on first mount. */
  init: Identifier | null;
  /** `emits CartUpdated, FormSubmitted`. */
  emits: Identifier[];
  /** `consumes CartUpdated`. */
  consumes: Identifier[];
  body: Block;
  decorators: Decorator[];
  directives: Directive[];
}

export interface EndpointDecl extends NodeBase {
  kind: "EndpointDecl";
  name: Identifier;
  params: Parameter[];
  /** Optional declared return type. */
  returnType: TypeRef | null;
  body: Block;
  decorators: Decorator[];
  directives: Directive[];
}

export interface ActionDecl extends NodeBase {
  kind: "ActionDecl";
  name: Identifier;
  params: Parameter[];
  emits: Identifier[];
  consumes: Identifier[];
  body: Block;
  decorators: Decorator[];
  directives: Directive[];
}

export interface DatabaseDecl extends NodeBase {
  kind: "DatabaseDecl";
  /** The backend identifier (`Postgres`, `MySQL`, `Sqlite`). */
  backend: Identifier;
  tables: TableDecl[];
  decorators: Decorator[];
  directives: Directive[];
}

export interface TableDecl extends NodeBase {
  kind: "TableDecl";
  name: Identifier;
  columns: ColumnDecl[];
  decorators: Decorator[];
}

export interface ColumnDecl extends NodeBase {
  kind: "ColumnDecl";
  type: TypeRef;
  name: Identifier;
  init: Expr | null;
  decorators: Decorator[];
}

export interface TypeDecl extends NodeBase {
  kind: "TypeDecl";
  name: Identifier;
  alias: TypeRef;
  decorators: Decorator[];
  directives: Directive[];
}

/** Placeholder used by error recovery in declaration position. */
export interface ErrorDecl extends NodeBase {
  kind: "ErrorDecl";
  message: string;
}

// ─────────────────────────────────────────────────────────────
//  ElementDecl — the unified labelled body line
// ─────────────────────────────────────────────────────────────

export interface ElementDecl extends NodeBase {
  kind: "ElementDecl";
  /** Label before the colon (e.g. "Title", "Number", "style", "Color"). */
  label: Identifier;
  /** Generic-type parameters on the label: `Array<Object>:` -> [TypeRef(Object)]. */
  labelGenerics: TypeRef[];
  /** Optional identifier after the colon (the "target" / variable name). */
  name: Identifier | null;
  /** Optional `from Base` clause. */
  base: Identifier | null;
  /** Optional `(...)` attribute / content block. */
  attrs: AttrList | null;
  /** Optional `<- expr` initialiser. */
  init: Expr | null;
  /** Optional `-> Block` or `-> Expr` body. */
  body: Block | Expr | null;
  decorators: Decorator[];
  directives: Directive[];
}

// ─────────────────────────────────────────────────────────────
//  Block
// ─────────────────────────────────────────────────────────────

/**
 * A BlockItem is anything that may appear inside a `( … )` body —
 * variable / element declarations, statements, or nested top-level
 * declarations (Style/Component/Endpoint/Action/Database/Type) when
 * they're written inline.
 */
export type BlockItem =
  | ElementDecl
  | Stmt
  | StyleDecl
  | ComponentDecl
  | EndpointDecl
  | ActionDecl
  | DatabaseDecl
  | TypeDecl
  | ErrorDecl;

export interface Block extends NodeBase {
  kind: "Block";
  items: BlockItem[];
}

// ─────────────────────────────────────────────────────────────
//  Statements
// ─────────────────────────────────────────────────────────────

export type Stmt =
  | IfStmt
  | WhileStmt
  | ForEachStmt
  | LoopStmt
  | RepeatStmt
  | MatchStmt
  | AttemptStmt
  | TransactionStmt
  | ParallelStmt
  | SequenceStmt
  | EventWireStmt
  | BindStmt
  | ApplyEffectStmt
  | ReactiveAssignStmt
  | SyncStmt
  | ReturnStmt
  | ThrowStmt
  | BreakStmt
  | ContinueStmt
  | YieldStmt
  | RequireStmt
  | AssertStmt
  | ExpectStmt
  | ExpressionStmt
  | ErrorStmt;

export interface IfBranch extends NodeBase {
  kind: "IfBranch";
  /** Null on the `else` branch (no condition). */
  condition: Expr | null;
  body: Block;
}

export interface IfStmt extends NodeBase {
  kind: "IfStmt";
  branches: IfBranch[];
}

export interface WhileStmt extends NodeBase {
  kind: "WhileStmt";
  condition: Expr;
  body: Block;
}

export interface ForEachStmt extends NodeBase {
  kind: "ForEachStmt";
  /** The iterable expression after `in`. */
  iterable: Expr;
  /** Loop variable (`forEach user in xs as u` -> binding is `u`). */
  binding: Identifier;
  body: Block;
}

export interface LoopStmt extends NodeBase {
  kind: "LoopStmt";
  body: Block;
}

export interface RepeatStmt extends NodeBase {
  kind: "RepeatStmt";
  /** Numeric or expression count: `repeat 5 times`. */
  count: Expr;
  body: Block;
}

export interface MatchCase extends NodeBase {
  kind: "MatchCase";
  /** Null on `otherwise`. */
  pattern: Expr | null;
  body: Block | Expr;
}

export interface MatchStmt extends NodeBase {
  kind: "MatchStmt";
  scrutinee: Expr;
  cases: MatchCase[];
}

export interface AttemptStmt extends NodeBase {
  kind: "AttemptStmt";
  body: Block;
  recoverBinding: Identifier | null;
  recoverBody: Block | null;
  ensureBody: Block | null;
}

export interface TransactionStmt extends NodeBase {
  kind: "TransactionStmt";
  body: Block;
}

export interface ParallelStmt extends NodeBase {
  kind: "ParallelStmt";
  body: Block;
}

export interface SequenceStmt extends NodeBase {
  kind: "SequenceStmt";
  body: Block;
}

export interface EventWireStmt extends NodeBase {
  kind: "EventWireStmt";
  /** The LHS event expression (Identifier or Member). */
  event: Expr;
  /** The RHS target: a Block (for `Click -> ( … )`) or a call/identifier. */
  handler: Block | Expr;
}

export interface BindStmt extends NodeBase {
  kind: "BindStmt";
  /** LHS element name (`InputField` in `InputField::Email`). */
  element: Identifier;
  /** RHS state identifier (`Email`). */
  target: Identifier;
  /** Optional trailing attribute list when written inline:
   *  `InputField::Email placeholder: "…"` — attrs come from
   *  the surrounding ElementDecl, so this is null at the stmt level. */
  attrs: AttrList | null;
}

export interface ApplyEffectStmt extends NodeBase {
  kind: "ApplyEffectStmt";
  target: Expr;
  effect: Expr;
}

export interface ReactiveAssignStmt extends NodeBase {
  kind: "ReactiveAssignStmt";
  target: Expr;
  value: Expr;
}

export interface SyncStmt extends NodeBase {
  kind: "SyncStmt";
  /** `a <-> b` — both sides participate in the two-way sync. */
  left: Expr;
  right: Expr;
}

export interface ReturnStmt extends NodeBase {
  kind: "ReturnStmt";
  value: Expr | null;
}

export interface ThrowStmt extends NodeBase {
  kind: "ThrowStmt";
  value: Expr;
}

export interface BreakStmt extends NodeBase {
  kind: "BreakStmt";
}

export interface ContinueStmt extends NodeBase {
  kind: "ContinueStmt";
}

export interface YieldStmt extends NodeBase {
  kind: "YieldStmt";
  value: Expr | null;
}

export interface RequireStmt extends NodeBase {
  kind: "RequireStmt";
  condition: Expr;
}

export interface AssertStmt extends NodeBase {
  kind: "AssertStmt";
  condition: Expr;
}

export interface ExpectStmt extends NodeBase {
  kind: "ExpectStmt";
  condition: Expr;
}

export interface ExpressionStmt extends NodeBase {
  kind: "ExpressionStmt";
  expression: Expr;
}

/** Placeholder used by error recovery in statement position. */
export interface ErrorStmt extends NodeBase {
  kind: "ErrorStmt";
  message: string;
}

// ─────────────────────────────────────────────────────────────
//  Expressions
// ─────────────────────────────────────────────────────────────

export type Expr =
  | NumberLit
  | StringLit
  | InterpolatedStringLit
  | BoolLit
  | NoneLit
  | HexColorLit
  | Identifier
  | DottedExpr
  | Member
  | Call
  | Index
  | Unary
  | Binary
  | Conditional
  | ArrayLit
  | ObjectLit
  | Injection
  | NativeBridge
  | ParenExpr
  | ErrorExpr;

export interface NumberLit extends NodeBase {
  kind: "NumberLit";
  value: number;
  raw: string;
}

export interface StringLit extends NodeBase {
  kind: "StringLit";
  value: string;
  raw: string;
}

export interface InterpolatedStringLit extends NodeBase {
  kind: "InterpolatedStringLit";
  /** Pieces alternate: literal chunks (`{ kind: "Chunk" }`) and
   *  `Expr` values. Empty leading/trailing chunks are preserved so the
   *  formatter can round-trip positions verbatim. */
  parts: (StringChunkPart | Expr)[];
}

export interface StringChunkPart extends NodeBase {
  kind: "StringChunkPart";
  value: string;
}

export interface BoolLit extends NodeBase {
  kind: "BoolLit";
  value: boolean;
}

export interface NoneLit extends NodeBase {
  kind: "NoneLit";
}

export interface HexColorLit extends NodeBase {
  kind: "HexColorLit";
  value: string;
}

export interface DottedExpr extends NodeBase {
  kind: "DottedExpr";
  parts: Identifier[];
}

export interface Member extends NodeBase {
  kind: "Member";
  object: Expr;
  property: Identifier;
}

export interface Call extends NodeBase {
  kind: "Call";
  callee: Expr;
  /** Positional and named args. */
  args: CallArg[];
}

export interface CallArg extends NodeBase {
  kind: "CallArg";
  /** Null for positional, identifier for `Name: value`. */
  name: Identifier | null;
  value: Expr;
}

export interface Index extends NodeBase {
  kind: "Index";
  object: Expr;
  index: Expr;
}

export interface Unary extends NodeBase {
  kind: "Unary";
  operator: "-" | "+" | "!" | "not";
  operand: Expr;
}

export interface Binary extends NodeBase {
  kind: "Binary";
  operator: BinaryOperator;
  left: Expr;
  right: Expr;
}

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or"
  | "xor"
  | "&&"
  | "||"
  | "|"
  | "is"
  | "is not"
  | "in"
  | "notIn"
  | "contains"
  | "matches"
  | "between"
  | "within"
  | "outside";

export interface Conditional extends NodeBase {
  kind: "Conditional";
  condition: Expr;
  consequent: Expr;
  alternate: Expr | null;
}

export interface ArrayLit extends NodeBase {
  kind: "ArrayLit";
  items: Expr[];
}

export interface ObjectLit extends NodeBase {
  kind: "ObjectLit";
  entries: ObjectEntry[];
}

export interface ObjectEntry extends NodeBase {
  kind: "ObjectEntry";
  key: Identifier;
  value: Expr;
}

export interface Injection extends NodeBase {
  kind: "Injection";
  /** The inner expression of `@{expr}` or `{expr}` (string-context). */
  expression: Expr;
}

export interface NativeBridge extends NodeBase {
  kind: "NativeBridge";
  language: Identifier;
  /** Inputs declared in the bridge: `in: a, b`. */
  inputs: Identifier[];
  /** Outputs declared: `out: x, y`. */
  outputs: Identifier[];
  /** Raw passthrough body (verbatim). */
  body: string;
}

export interface ParenExpr extends NodeBase {
  kind: "ParenExpr";
  expression: Expr;
}

/** Placeholder used by error recovery in expression position. */
export interface ErrorExpr extends NodeBase {
  kind: "ErrorExpr";
  message: string;
}

// ─────────────────────────────────────────────────────────────
//  Type-level helpers
// ─────────────────────────────────────────────────────────────

export type AnyNode =
  | FileNode
  | Directive
  | UsingDecl
  | TopLevelDecl
  | TableDecl
  | ColumnDecl
  | ElementDecl
  | Block
  | Stmt
  | Expr
  | Identifier
  | DottedName
  | TypeRef
  | Decorator
  | Parameter
  | Attribute
  | AttrList
  | IfBranch
  | MatchCase
  | CallArg
  | StringChunkPart
  | ObjectEntry;

/** Discriminator for every kind. Useful for printer/visitor switches. */
export type NodeKind = AnyNode["kind"];

// ─────────────────────────────────────────────────────────────
//  Convenience constructors
// ─────────────────────────────────────────────────────────────

export function makeIdentifier(name: string, span: SourceSpan): Identifier {
  return { kind: "Identifier", name, span };
}

export function emptyBlock(span: SourceSpan): Block {
  return { kind: "Block", items: [], span };
}
