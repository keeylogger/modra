/**
 * Modra Phase 2 — Parser entry point.
 *
 * The Parser consumes a Token stream (filtered: no trivia) and emits a
 * `FileNode` AST. It is single-use: construct one per source file,
 * call `parseFile()` once, inspect `diagnostics`, then discard.
 *
 * `TokenCursor` is the shared cursor + diagnostic helper used by every
 * sub-parser (pratt.ts, statements.ts, declarations.ts).
 */

import { Scanner } from "../lexer/scanner.js";
import { TokenType, type KeywordName, type Token } from "../lexer/tokens.js";
import { SourceFile, type SourceSpan } from "../utils/source.js";
import {
  DiagnosticCollector,
  type Diagnostic,
} from "../utils/diagnostics.js";
import { parseFile } from "./declarations.js";
import type { FileNode } from "../ast/nodes.js";

// ─────────────────────────────────────────────────────────────
//  TokenCursor
// ─────────────────────────────────────────────────────────────

/**
 * Cursor over a Token array with diagnostic collection and a fixed
 * EOF sentinel. The cursor never advances past EOF; `next()` after EOF
 * returns the EOF token repeatedly.
 *
 * `peek()` / `next()` transparently skip Newline tokens — most of the
 * grammar is layout-insensitive between tokens. `peekRaw()` and
 * `atNewline()` are escape hatches for statement parsing, where
 * newlines act as separators.
 */
export class TokenCursor {
  private readonly tokens: Token[];
  private position = 0;
  private readonly diag: DiagnosticCollector;
  readonly file: string;

  constructor(tokens: Token[], file: string, diag: DiagnosticCollector) {
    this.tokens = tokens;
    this.file = file;
    this.diag = diag;
  }

  /** Peek the Nth significant (non-newline) token from the cursor. */
  peek(offset = 0): Token {
    let idx = this.position;
    let remaining = offset;
    while (idx < this.tokens.length) {
      const tok = this.tokens[idx]!;
      if (tok.type !== TokenType.Newline) {
        if (remaining === 0) return tok;
        remaining--;
      }
      idx++;
    }
    return this.tokens[this.tokens.length - 1]!;
  }

  /** Peek the immediate next token (newlines visible). */
  peekRaw(offset = 0): Token {
    const idx = this.position + offset;
    if (idx >= this.tokens.length) {
      return this.tokens[this.tokens.length - 1]!;
    }
    return this.tokens[idx]!;
  }

  /** True if the *immediately* next token is a Newline (no skipping). */
  atNewline(): boolean {
    return this.peekRaw().type === TokenType.Newline;
  }

  /** Skip one or more contiguous Newline tokens. */
  skipNewlines(): void {
    while (this.peekRaw().type === TokenType.Newline) {
      this.position++;
    }
  }

  /** Consume and return the next significant token. */
  next(): Token {
    this.skipNewlines();
    const tok = this.tokens[this.position] ?? this.tokens[this.tokens.length - 1]!;
    if (this.position < this.tokens.length - 1) {
      this.position++;
    }
    return tok;
  }

  previous(): Token {
    // Walk backwards over any newlines.
    let idx = this.position - 1;
    while (idx > 0 && this.tokens[idx]!.type === TokenType.Newline) idx--;
    if (idx < 0) return this.tokens[0]!;
    return this.tokens[idx]!;
  }

  isAtEnd(): boolean {
    return this.peek().type === TokenType.Eof;
  }

  check(type: TokenType): boolean {
    return this.peek().type === type;
  }

  checkKeyword(name: KeywordName): boolean {
    const t = this.peek();
    return t.type === TokenType.Keyword && t.keyword === name;
  }

  match(type: TokenType): Token | null {
    if (this.check(type)) return this.next();
    return null;
  }

  matchKeyword(name: KeywordName): Token | null {
    if (this.checkKeyword(name)) return this.next();
    return null;
  }

  /**
   * Consume one token of the expected type. If the actual token
   * differs, record a diagnostic and return the WRONG token without
   * advancing (so the caller can recover). When `keywordName` is
   * passed and `type === Keyword`, the keyword name must also match.
   */
  consume(type: TokenType, message: string, keywordName?: KeywordName): Token {
    const tok = this.peek();
    const typeOk = tok.type === type;
    const kwOk =
      keywordName === undefined ||
      (tok.type === TokenType.Keyword && tok.keyword === keywordName);
    if (typeOk && kwOk) {
      return this.next();
    }
    this.error("MOD-P001", message, tok.span);
    return tok;
  }

  /** Record an error diagnostic. */
  error(code: string, message: string, span: SourceSpan, hint?: string): void {
    this.diag.error({ code, message, span, file: this.file, ...(hint ? { hint } : {}) });
  }

  /** Record a warning diagnostic. */
  warn(code: string, message: string, span: SourceSpan, hint?: string): void {
    this.diag.warn({ code, message, span, file: this.file, ...(hint ? { hint } : {}) });
  }

  /** Useful for debug: dump the next few tokens as a string. */
  describePeek(n = 5): string {
    return Array.from({ length: n }, (_, i) => this.peek(i).lexeme).join(" ");
  }
}

// ─────────────────────────────────────────────────────────────
//  Parser
// ─────────────────────────────────────────────────────────────

export interface ParseResult {
  ast: FileNode;
  diagnostics: readonly Diagnostic[];
}

export class Parser {
  private readonly source: SourceFile;
  private readonly diag = new DiagnosticCollector();

  constructor(source: string | SourceFile, filePath?: string) {
    if (source instanceof SourceFile) {
      this.source = source;
    } else {
      this.source = new SourceFile(filePath ?? "<anonymous>", source);
    }
  }

  /** Parse the source file into a FileNode AST. */
  parseFile(): ParseResult {
    const scanner = new Scanner(this.source);
    // We keep Newlines so the parser can use them as statement
    // separators; whitespace and comments are dropped because Modra's
    // grammar is layout-insensitive between tokens on the same line.
    const tokens = scanner
      .scanAll({ keepTrivia: true })
      .filter(
        (t) =>
          t.type !== TokenType.Whitespace &&
          t.type !== TokenType.CommentLine &&
          t.type !== TokenType.CommentBlock,
      );
    for (const d of scanner.diagnostics) this.diag.add(d);
    const cur = new TokenCursor(tokens, this.source.path, this.diag);
    const ast = parseFile(cur);
    return { ast, diagnostics: this.diag.all };
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.diag.all;
  }
}

/**
 * Convenience entry point: scan + parse + collect, returning the
 * FileNode and any diagnostics. Equivalent to `new Parser(src).parseFile()`.
 */
export function parse(source: string, filePath?: string): ParseResult {
  return new Parser(source, filePath).parseFile();
}
