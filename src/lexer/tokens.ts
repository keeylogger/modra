/**
 * Modra v2 token catalogue.
 *
 * Every glyph and keyword the language understands has a TokenType here.
 * The Scanner (scanner.ts) consumes characters and produces a stream of
 * Token values; the Parser (Phase 2) consumes that stream.
 *
 * Grouping convention on the enum: tokens are ordered roughly by
 * "structural importance" so debug output (printed via the CLI's `lex`
 * command) groups related kinds together.
 */

import type { SourceSpan } from "../utils/source.js";

export enum TokenType {
  // ─── Modra arrows ─────────────────────────────────────────────
  AssignLeft = "AssignLeft", //   <-
  FlowRight = "FlowRight", //     ->
  SyncBoth = "SyncBoth", //       <->
  ApplyEffect = "ApplyEffect", // <:
  BindState = "BindState", //     ::
  ThickArrow = "ThickArrow", //   =>

  // ─── Comparison / equality ───────────────────────────────────
  LessThan = "LessThan", //       <
  GreaterThan = "GreaterThan", // >
  LessEqual = "LessEqual", //     <=
  GreaterEqual = "GreaterEqual", // >=
  EqualsEquals = "EqualsEquals", // ==
  BangEquals = "BangEquals", //   !=

  // ─── Arithmetic ──────────────────────────────────────────────
  Plus = "Plus", //               +
  Minus = "Minus", //             -
  Star = "Star", //               *
  Slash = "Slash", //             /
  Percent = "Percent", //         %

  // ─── Logic ───────────────────────────────────────────────────
  LogicalAnd = "LogicalAnd", //   &&
  LogicalOr = "LogicalOr", //     ||
  Bang = "Bang", //               !

  // ─── Pipe / misc operators ───────────────────────────────────
  Pipe = "Pipe", //               |
  Equals = "Equals", //           =  (assignment separator; rarely used directly)

  // ─── Punctuation ─────────────────────────────────────────────
  LParen = "LParen", //           (
  RParen = "RParen", //           )
  LBrace = "LBrace", //           {
  RBrace = "RBrace", //           }
  LBracket = "LBracket", //       [
  RBracket = "RBracket", //       ]
  Comma = "Comma", //             ,
  Colon = "Colon", //             :
  Dot = "Dot", //                 .
  Semicolon = "Semicolon", //     ;
  Question = "Question", //       ?

  // ─── Injection ───────────────────────────────────────────────
  InjectStart = "InjectStart", // @{
  InjectEnd = "InjectEnd", //     } closing an injection

  // ─── Decorator (@Identifier) ─────────────────────────────────
  Decorator = "Decorator", //     @Primary, @Unique, @ForeignKey…

  // ─── Directive (@@) ──────────────────────────────────────────
  DirectiveAt = "DirectiveAt", // @@  (identifier, args, value follow as normal tokens)

  // ─── Native body ─────────────────────────────────────────────
  NativeBody = "NativeBody", //   raw captured passthrough text

  // ─── String tokens ───────────────────────────────────────────
  /**
   * A literal chunk between string delimiters or between two {expr}
   * injections. The Scanner always emits strings as a sequence of
   * StringChunk + (InjectStart … InjectEnd)* + StringChunk so the parser
   * never has to re-lex. Empty leading/trailing chunks are still emitted
   * to anchor positions for the formatter.
   */
  StringChunk = "StringChunk",
  /**
   * A *simple* string literal (no interpolation) — convenience emission
   * when the entire content is a single chunk and there is no injection.
   * The Scanner emits this whenever it can, falling back to the chunked
   * form when an injection appears.
   */
  StringLiteral = "StringLiteral",

  // ─── Numeric / colour literals ──────────────────────────────
  NumberLiteral = "NumberLiteral", // 42, 3.14, 0.95
  HexColor = "HexColor", //           #1D1D1F, #fff, #00000080

  // ─── Bool / none literals ───────────────────────────────────
  BoolLiteral = "BoolLiteral", //  true | false
  NoneLiteral = "NoneLiteral", //  none

  // ─── Identifiers & keywords ─────────────────────────────────
  Identifier = "Identifier",
  Keyword = "Keyword",

  // ─── Comments & trivia ──────────────────────────────────────
  CommentLine = "CommentLine", //  // …
  CommentBlock = "CommentBlock", // /* … */
  Newline = "Newline", //          \n (filtered by default)
  Whitespace = "Whitespace", //    runs of space/tab (filtered by default)

  // ─── End of input ───────────────────────────────────────────
  Eof = "Eof",
}

/** Categorisation of keyword by Modra's hybrid casing rule. */
export type KeywordCase = "title" | "lower";

/**
 * A single token emitted by the Scanner. The `lexeme` preserves the
 * exact source text (including original spelling and any escape
 * sequences); `value` carries the parsed runtime value where one exists.
 */
export interface Token {
  type: TokenType;
  lexeme: string;
  value: string | number | boolean | null;
  span: SourceSpan;
  file: string;
  /**
   * Set when `type === TokenType.Keyword`; identifies *which* keyword
   * (lowercased exact spelling). Lets the parser branch without
   * re-comparing strings.
   */
  keyword?: KeywordName;
}

/**
 * All keyword names known to the Modra v2 lexer.
 *
 * The list is split into "title" (structural declarations — always
 * PascalCase) and "lower" (control flow, modifiers, English aliases — always
 * lowercase). The Scanner looks up identifier text in the KEYWORDS map
 * preserving case; identifiers that match a keyword are emitted as
 * TokenType.Keyword with the `keyword` field populated.
 */
export const TITLE_CASE_KEYWORDS = [
  "Style",
  "Component",
  "Endpoint",
  "Action",
  "Database",
  "Table",
  "Type",
  "Module",
  "Native",
  "Record",
  "Schema",
  "On",
  "Return",
  "Throw",
  "Yield",
  "Break",
  "Continue",
] as const;

export const LOWERCASE_KEYWORDS = [
  // control flow
  "if",
  "else",
  "elif",
  "then",
  "while",
  "until",
  "forEach",
  "in",
  "as",
  "loop",
  "repeat",
  "times",
  "skip",
  "match",
  "case",
  "otherwise",
  // error handling
  "attempt",
  "recover",
  "ensure",
  "raise",
  "assert",
  "expect",
  "require",
  // async / concurrency
  "async",
  "await",
  "defer",
  "parallel",
  "sequence",
  // visibility / mutability
  "public",
  "private",
  "internal",
  "readonly",
  "mutable",
  "const",
  "static",
  "instance",
  // composition / typing
  "from",
  "extends",
  "implements",
  "with",
  "uses",
  "using",
  "is",
  "not",
  "and",
  "or",
  "xor",
  "optional",
  "nullable",
  "required",
  // Modra signature prose
  "flowsTo",
  "bindsTo",
  "triggers",
  "dispatches",
  "emits",
  "consumes",
  "composes",
  "wraps",
  "watches",
  "observes",
  "derived",
  // lifecycle
  "when",
  "before",
  "after",
  "during",
  "init",
  "mounted",
  "unmounted",
  "ready",
  "cleanup",
  "teardown",
  // predicates / set ops
  "each",
  "every",
  "some",
  "all",
  "any",
  "notIn",
  "contains",
  "matches",
  "between",
  "within",
  "outside",
  "empty",
  "present",
  "missing",
  // module-level
  "export",
  "expose",
  // database
  "transaction",
  "commit",
  "rollback",
  // bool literals
  "true",
  "false",
] as const;

export type TitleKeyword = (typeof TITLE_CASE_KEYWORDS)[number];
export type LowerKeyword = (typeof LOWERCASE_KEYWORDS)[number];
export type KeywordName = TitleKeyword | LowerKeyword;

/**
 * The single source of truth for keyword lookups. Map key is the EXACT
 * spelling (case-sensitive). The Scanner reads an identifier and queries
 * this map; a hit produces a Keyword token with the matched name.
 *
 * Note: `none` is *not* listed here — it's a literal, emitted as
 * TokenType.NoneLiteral. `true`/`false` are kept here as keywords but
 * the Scanner promotes them to TokenType.BoolLiteral on emission so the
 * parser sees them as values, not identifiers.
 */
type KeywordEntry = readonly [string, { name: KeywordName; case: KeywordCase }];

export const KEYWORDS: ReadonlyMap<string, { name: KeywordName; case: KeywordCase }> = new Map<
  string,
  { name: KeywordName; case: KeywordCase }
>([
  ...TITLE_CASE_KEYWORDS.map(
    (k): KeywordEntry => [k, { name: k, case: "title" }],
  ),
  ...LOWERCASE_KEYWORDS.map(
    (k): KeywordEntry => [k, { name: k, case: "lower" }],
  ),
]);

/**
 * Helper: build a Token. Kept here (rather than the Scanner) so future
 * tools (parser, formatter, LSP) can synthesise tokens without a
 * round-trip through scanning.
 */
export function makeToken(
  type: TokenType,
  lexeme: string,
  value: string | number | boolean | null,
  span: SourceSpan,
  file: string,
  keyword?: KeywordName,
): Token {
  const tok: Token = { type, lexeme, value, span, file };
  if (keyword !== undefined) {
    tok.keyword = keyword;
  }
  return tok;
}

/** Human-friendly description of a token type — used in diagnostics. */
export function describeTokenType(type: TokenType): string {
  switch (type) {
    case TokenType.AssignLeft:
      return "assignment arrow '<-'";
    case TokenType.FlowRight:
      return "flow arrow '->'";
    case TokenType.SyncBoth:
      return "two-way sync arrow '<->'";
    case TokenType.ApplyEffect:
      return "effect-apply arrow '<:'";
    case TokenType.BindState:
      return "bind-state operator '::'";
    case TokenType.ThickArrow:
      return "thick arrow '=>'";
    case TokenType.InjectStart:
      return "injection opener '@{'";
    case TokenType.InjectEnd:
      return "injection / brace closer '}'";
    case TokenType.Decorator:
      return "decorator '@…'";
    case TokenType.DirectiveAt:
      return "directive marker '@@'";
    case TokenType.NativeBody:
      return "native passthrough body";
    case TokenType.StringChunk:
      return "string chunk";
    case TokenType.StringLiteral:
      return "string literal";
    case TokenType.NumberLiteral:
      return "number literal";
    case TokenType.HexColor:
      return "hex colour";
    case TokenType.BoolLiteral:
      return "boolean literal";
    case TokenType.NoneLiteral:
      return "none literal";
    case TokenType.Identifier:
      return "identifier";
    case TokenType.Keyword:
      return "keyword";
    case TokenType.CommentLine:
      return "line comment";
    case TokenType.CommentBlock:
      return "block comment";
    case TokenType.Newline:
      return "newline";
    case TokenType.Whitespace:
      return "whitespace";
    case TokenType.Eof:
      return "end of file";
    default:
      return type;
  }
}
