/**
 * Public API barrel for the Modra compiler library.
 *
 * Consumers (the CLI, future LSP server, embedders) import from here.
 * Internal-only types stay inside their respective submodules.
 */

// ─── Phase 1: Lexer ──────────────────────────────────────────
export {
  Scanner,
  TokenType,
  KEYWORDS,
  TITLE_CASE_KEYWORDS,
  LOWERCASE_KEYWORDS,
  describeTokenType,
  LexerMode,
  type ScanOptions,
  type Token,
  type KeywordName,
} from "./lexer/index.js";

// ─── Phase 2: AST & Parser ──────────────────────────────────
export * from "./ast/index.js";
export {
  Parser,
  parse,
  TokenCursor,
  parseExpression,
  parseFile as parseFileTokens,
  type ParseResult,
} from "./parser/index.js";

// ─── Phase 4: Emitters ──────────────────────────────────────
export {
  emitProject,
  lower,
  emitReact,
  emitNode,
  emitPostgresDDL,
  emitBridge,
  type ProjectIR,
  type ProjectEmission,
  type ProjectFile,
  type ClientModuleIR,
  type ServerModuleIR,
  type SchemaModuleIR,
  type BridgeModuleIR,
} from "./emit/index.js";

// ─── Phase 3: Semantic analysis ─────────────────────────────
export {
  analyze,
  Scope,
  makeSymbol,
  Resolver,
  ResolutionMap,
  TypeChecker,
  ReactivityAnalyzer,
  ReactivityGraph,
  TargetingPass,
  describeType,
  fromTypeRef,
  isAssignable,
  TAny,
  TBool,
  TColor,
  TDateTime,
  TNone,
  TNumber,
  TString,
  tArray,
  tFunction,
  tMap,
  tObject,
  tOption,
  tRef,
  type AnalysisResult,
  type AnalyzeOptions,
  type SymbolDecl,
  type SymbolKind,
  type TargetClassification,
  type TargetingResult,
  type Type,
  type ReactiveNode,
  type ReactiveWrite,
} from "./semantic/index.js";

// ─── Utilities ──────────────────────────────────────────────
export {
  SourceFile,
  formatSpan,
  type SourcePosition,
  type SourceSpan,
} from "./utils/source.js";

export {
  DiagnosticCollector,
  formatDiagnostic,
  type Diagnostic,
  type DiagnosticSeverity,
} from "./utils/diagnostics.js";

export {
  formatPrettyDiagnostic,
  type PrettyOptions,
} from "./utils/pretty-diagnostics.js";

export type {
  EmitterTarget,
  FrontendTarget,
  BackendTarget,
  DatabaseTarget,
} from "./types.js";
