/**
 * Modra Phase 1 — Scanner.
 *
 * Hand-rolled character-peeking state machine driven by a mode stack
 * (see ./modes.ts). The Scanner is *single-use*: construct one per
 * source file, call `scanAll()` (or pull tokens with `next()`), inspect
 * `diagnostics`, then discard.
 *
 * The Scanner never throws on recoverable errors. It records a
 * diagnostic, synthesises a best-effort token, and keeps going. Fatal
 * shapes (unterminated string at EOF, unbalanced native block) record a
 * diagnostic and then return EOF early.
 */

import { DiagnosticCollector, type Diagnostic } from "../utils/diagnostics.js";
import { SourceFile, type SourcePosition, type SourceSpan } from "../utils/source.js";
import { isHexDigit, isIdentCont, isIdentStart, isDigit } from "./char-utils.js";
import { LexerMode, ModeStack } from "./modes.js";
import {
  KEYWORDS,
  makeToken,
  type KeywordName,
  type Token,
  TokenType,
} from "./tokens.js";

export interface ScanOptions {
  /** When true, the Scanner keeps whitespace, newlines, and comments in the output. */
  keepTrivia?: boolean;
}

export class Scanner {
  private readonly source: SourceFile;
  private readonly text: string;
  private readonly diag = new DiagnosticCollector();
  private readonly modes = new ModeStack();

  private offset = 0;
  private line = 1;
  private column = 1;

  /**
   * Stack of brace depths for the Injection mode. Each time we enter
   * Injection mode we push a fresh `1` (for the opening `{` / `@{`);
   * each `{` we encounter while inside Injection increments the top of
   * the stack and each `}` decrements it. When the top reaches 0 we pop
   * the mode and the depth stack together.
   */
  private readonly injectionDepth: number[] = [];

  /**
   * After the `Keyword(Native)` token is emitted, the next `{` in Modra
   * mode opens a Native body. We arm this flag on emit and disarm it
   * once the body opens (or any non-prelude token in between makes the
   * native syntax impossible, but that's a parser concern — we just
   * arm/disarm here).
   */
  private nativeArmed = false;

  /** Buffer of tokens produced but not yet returned via `next()`. */
  private buffered: Token[] = [];
  /** When set, all subsequent `next()` calls return EOF. */
  private exhausted = false;

  constructor(source: string | SourceFile, filePath?: string) {
    if (source instanceof SourceFile) {
      this.source = source;
    } else {
      this.source = new SourceFile(filePath ?? "<anonymous>", source);
    }
    this.text = this.source.normalisedText;
  }

  /** Run the Scanner to completion and return every token. */
  scanAll(opts: ScanOptions = {}): Token[] {
    const keepTrivia = opts.keepTrivia === true;
    const out: Token[] = [];
    // Drain any tokens previously buffered by `next()` / `peek()` callers.
    while (this.buffered.length > 0) {
      const tok = this.buffered.shift()!;
      if (keepTrivia || !isTrivia(tok.type)) out.push(tok);
      if (tok.type === TokenType.Eof) return out;
    }
    while (true) {
      const tok = this.scanOne();
      if (keepTrivia || !isTrivia(tok.type)) out.push(tok);
      if (tok.type === TokenType.Eof) return out;
    }
  }

  /** Pull-one entry point used by the future Parser. Trivia included. */
  next(): Token {
    if (this.buffered.length > 0) return this.buffered.shift()!;
    return this.scanOne();
  }

  /** Lookahead — peek N tokens ahead without consuming. */
  peek(offset = 0): Token {
    while (this.buffered.length <= offset) {
      this.buffered.push(this.scanOne());
    }
    return this.buffered[offset]!;
  }

  get diagnostics(): readonly Diagnostic[] {
    return this.diag.all;
  }

  // ─────────────────────────────────────────────────────────────
  //  Core dispatch
  // ─────────────────────────────────────────────────────────────

  private scanOne(): Token {
    if (this.exhausted) {
      return this.eofToken();
    }
    switch (this.modes.current) {
      case LexerMode.Modra:
        return this.scanInModra();
      case LexerMode.Injection:
        // Injection mode reuses Modra rules but tracks brace depth.
        return this.scanInInjection();
      case LexerMode.NativeBody:
        return this.scanNativeBody();
      case LexerMode.String:
        return this.scanInString();
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  MODRA / INJECTION mode (almost identical)
  // ─────────────────────────────────────────────────────────────

  private scanInModra(): Token {
    return this.scanModraLike(/* insideInjection */ false);
  }

  private scanInInjection(): Token {
    return this.scanModraLike(/* insideInjection */ true);
  }

  private scanModraLike(insideInjection: boolean): Token {
    // Skip whitespace + comments unless they themselves yield a token
    // we want to emit (newlines and comments produce trivia tokens).
    const triviaTok = this.scanTrivia();
    if (triviaTok) return triviaTok;

    if (this.isAtEnd()) {
      return this.eofToken();
    }

    const start = this.position();
    const ch = this.peekChar();

    // ─── Single/multi-character operators ──────────────
    switch (ch) {
      case "<":
        return this.scanLessThanFamily(start);
      case ">":
        return this.scanGreaterThanFamily(start);
      case "-":
        return this.scanMinusFamily(start);
      case "=":
        return this.scanEqualsFamily(start);
      case "!":
        return this.scanBangFamily(start);
      case "&":
        return this.scanAmpFamily(start);
      case "|":
        return this.scanPipeFamily(start);
      case ":":
        return this.scanColonFamily(start);
      case "@":
        return this.scanAtFamily(start);
      case "+":
        return this.emitSingle(start, TokenType.Plus, "+");
      case "*":
        return this.emitSingle(start, TokenType.Star, "*");
      case "/":
        // `/` was already handled in trivia (// or /*); if we're here
        // it's a real division.
        return this.emitSingle(start, TokenType.Slash, "/");
      case "%":
        return this.emitSingle(start, TokenType.Percent, "%");
      case "(":
        return this.emitSingle(start, TokenType.LParen, "(");
      case ")":
        return this.emitSingle(start, TokenType.RParen, ")");
      case "[":
        return this.emitSingle(start, TokenType.LBracket, "[");
      case "]":
        return this.emitSingle(start, TokenType.RBracket, "]");
      case ",":
        return this.emitSingle(start, TokenType.Comma, ",");
      case ";":
        return this.emitSingle(start, TokenType.Semicolon, ";");
      case ".":
        return this.emitSingle(start, TokenType.Dot, ".");
      case "?":
        return this.emitSingle(start, TokenType.Question, "?");
      case "{":
        return this.scanOpenBrace(start, insideInjection);
      case "}":
        return this.scanCloseBrace(start, insideInjection);
      case "#":
        return this.scanHexColor(start);
      case '"':
        return this.scanStringOpener(start);
    }

    // ─── Identifiers / keywords ────────────────────────
    if (isIdentStart(ch)) {
      return this.scanIdentifierOrKeyword(start);
    }

    // ─── Numbers ───────────────────────────────────────
    if (isDigit(ch)) {
      return this.scanNumber(start);
    }

    // ─── Unknown character: record + advance + retry ───
    this.advance();
    this.diag.error({
      code: "MOD-L001",
      message: `Unexpected character '${ch}'`,
      span: this.spanFrom(start),
      file: this.source.path,
    });
    return this.scanOne();
  }

  // ─────────────────────────────────────────────────────────────
  //  Operator-family helpers
  // ─────────────────────────────────────────────────────────────

  private scanLessThanFamily(start: SourcePosition): Token {
    // Possible: <- <= <-> <: <
    this.advance(); // consume '<'
    const next = this.peekChar();
    if (next === "-") {
      this.advance();
      // Could be `<->`
      if (this.peekChar() === ">") {
        this.advance();
        return this.makeAt(start, TokenType.SyncBoth, "<->", "<->");
      }
      return this.makeAt(start, TokenType.AssignLeft, "<-", "<-");
    }
    if (next === "=") {
      this.advance();
      return this.makeAt(start, TokenType.LessEqual, "<=", "<=");
    }
    if (next === ":") {
      this.advance();
      return this.makeAt(start, TokenType.ApplyEffect, "<:", "<:");
    }
    return this.makeAt(start, TokenType.LessThan, "<", "<");
  }

  private scanGreaterThanFamily(start: SourcePosition): Token {
    this.advance(); // '>'
    if (this.peekChar() === "=") {
      this.advance();
      return this.makeAt(start, TokenType.GreaterEqual, ">=", ">=");
    }
    return this.makeAt(start, TokenType.GreaterThan, ">", ">");
  }

  private scanMinusFamily(start: SourcePosition): Token {
    this.advance(); // '-'
    if (this.peekChar() === ">") {
      this.advance();
      return this.makeAt(start, TokenType.FlowRight, "->", "->");
    }
    return this.makeAt(start, TokenType.Minus, "-", "-");
  }

  private scanEqualsFamily(start: SourcePosition): Token {
    this.advance(); // '='
    const next = this.peekChar();
    if (next === "=") {
      this.advance();
      return this.makeAt(start, TokenType.EqualsEquals, "==", "==");
    }
    if (next === ">") {
      this.advance();
      return this.makeAt(start, TokenType.ThickArrow, "=>", "=>");
    }
    return this.makeAt(start, TokenType.Equals, "=", "=");
  }

  private scanBangFamily(start: SourcePosition): Token {
    this.advance(); // '!'
    if (this.peekChar() === "=") {
      this.advance();
      return this.makeAt(start, TokenType.BangEquals, "!=", "!=");
    }
    return this.makeAt(start, TokenType.Bang, "!", "!");
  }

  private scanAmpFamily(start: SourcePosition): Token {
    this.advance(); // '&'
    if (this.peekChar() === "&") {
      this.advance();
      return this.makeAt(start, TokenType.LogicalAnd, "&&", "&&");
    }
    // Bare '&' is not a Modra token; record and continue.
    this.diag.error({
      code: "MOD-L002",
      message: "Bare '&' is not a Modra operator. Did you mean '&&'?",
      span: this.spanFrom(start),
      file: this.source.path,
      hint: "Use '&&' for logical AND, or 'and' for the English alias.",
    });
    // Synthesise as if it were '&&' so downstream tools keep going.
    return this.makeAt(start, TokenType.LogicalAnd, "&", "&");
  }

  private scanPipeFamily(start: SourcePosition): Token {
    this.advance(); // '|'
    if (this.peekChar() === "|") {
      this.advance();
      return this.makeAt(start, TokenType.LogicalOr, "||", "||");
    }
    return this.makeAt(start, TokenType.Pipe, "|", "|");
  }

  private scanColonFamily(start: SourcePosition): Token {
    this.advance(); // ':'
    if (this.peekChar() === ":") {
      this.advance();
      return this.makeAt(start, TokenType.BindState, "::", "::");
    }
    return this.makeAt(start, TokenType.Colon, ":", ":");
  }

  private scanAtFamily(start: SourcePosition): Token {
    // Possible: @@ → DirectiveAt
    //           @{ → InjectStart (+ push Injection)
    //           @Identifier → Decorator
    //           bare @ → recoverable error
    this.advance(); // '@'
    const next = this.peekChar();
    if (next === "@") {
      this.advance();
      return this.makeAt(start, TokenType.DirectiveAt, "@@", "@@");
    }
    if (next === "{") {
      this.advance();
      this.modes.push(LexerMode.Injection);
      this.injectionDepth.push(1);
      return this.makeAt(start, TokenType.InjectStart, "@{", "@{");
    }
    if (isIdentStart(next)) {
      const nameStart = this.offset;
      this.advance();
      while (!this.isAtEnd() && isIdentCont(this.peekChar())) this.advance();
      const name = this.text.slice(nameStart, this.offset);
      const lexeme = `@${name}`;
      return this.makeAt(start, TokenType.Decorator, lexeme, name);
    }
    // Bare '@' followed by nothing useful — recoverable.
    this.diag.error({
      code: "MOD-L003",
      message: "Stray '@' is not a Modra token.",
      span: this.spanFrom(start),
      file: this.source.path,
      hint: "Use '@Identifier' for a decorator, '@{expr}' for an injection, or '@@directive' for a pragma.",
    });
    return this.makeAt(start, TokenType.Decorator, "@", "");
  }

  private scanOpenBrace(start: SourcePosition, insideInjection: boolean): Token {
    this.advance(); // '{'
    // If a Native body is armed and we're in Modra mode, this `{` opens it.
    if (this.nativeArmed && !insideInjection) {
      this.nativeArmed = false;
      const tok = this.makeAt(start, TokenType.LBrace, "{", "{");
      this.modes.push(LexerMode.NativeBody);
      return tok;
    }
    if (insideInjection) {
      // Nested `{` inside an injection bumps the brace depth.
      const top = this.injectionDepth[this.injectionDepth.length - 1] ?? 0;
      this.injectionDepth[this.injectionDepth.length - 1] = top + 1;
    }
    return this.makeAt(start, TokenType.LBrace, "{", "{");
  }

  private scanCloseBrace(start: SourcePosition, insideInjection: boolean): Token {
    this.advance(); // '}'
    if (insideInjection) {
      const top = this.injectionDepth[this.injectionDepth.length - 1] ?? 0;
      const newDepth = top - 1;
      if (newDepth <= 0) {
        // Closing the injection.
        this.injectionDepth.pop();
        this.modes.pop();
        return this.makeAt(start, TokenType.InjectEnd, "}", "}");
      }
      this.injectionDepth[this.injectionDepth.length - 1] = newDepth;
    }
    return this.makeAt(start, TokenType.RBrace, "}", "}");
  }

  // ─────────────────────────────────────────────────────────────
  //  Identifiers, keywords, literals
  // ─────────────────────────────────────────────────────────────

  private scanIdentifierOrKeyword(start: SourcePosition): Token {
    const startOffset = this.offset;
    while (!this.isAtEnd() && isIdentCont(this.peekChar())) this.advance();
    const lexeme = this.text.slice(startOffset, this.offset);

    const kw = KEYWORDS.get(lexeme);
    if (kw) {
      // `true`/`false` are syntactically keywords but semantically
      // boolean literals — emit them as BoolLiteral so the parser
      // doesn't have to special-case them.
      if (lexeme === "true" || lexeme === "false") {
        return this.makeAt(start, TokenType.BoolLiteral, lexeme, lexeme === "true");
      }
      const tok = this.makeAt(start, TokenType.Keyword, lexeme, lexeme, kw.name);
      if (kw.name === "Native") {
        // Arm the Native-body detector. The next top-level `{` will
        // open the raw-passthrough body.
        this.nativeArmed = true;
      }
      return tok;
    }
    if (lexeme === "none") {
      return this.makeAt(start, TokenType.NoneLiteral, "none", null);
    }
    return this.makeAt(start, TokenType.Identifier, lexeme, lexeme);
  }

  private scanNumber(start: SourcePosition): Token {
    const startOffset = this.offset;
    while (!this.isAtEnd() && isDigit(this.peekChar())) this.advance();
    if (this.peekChar() === "." && isDigit(this.peekCharAt(1))) {
      this.advance(); // '.'
      while (!this.isAtEnd() && isDigit(this.peekChar())) this.advance();
    }
    const lexeme = this.text.slice(startOffset, this.offset);
    const value = Number(lexeme);
    return this.makeAt(start, TokenType.NumberLiteral, lexeme, value);
  }

  private scanHexColor(start: SourcePosition): Token {
    const startOffset = this.offset;
    this.advance(); // '#'
    const digitStart = this.offset;
    while (!this.isAtEnd() && isHexDigit(this.peekChar())) this.advance();
    const digitCount = this.offset - digitStart;
    const lexeme = this.text.slice(startOffset, this.offset);
    if (digitCount !== 3 && digitCount !== 6 && digitCount !== 8) {
      this.diag.error({
        code: "MOD-L004",
        message: `Invalid hex colour '${lexeme}'.`,
        span: this.spanFrom(start),
        file: this.source.path,
        hint: "Hex colours must have exactly 3, 6, or 8 hex digits after '#'.",
      });
    }
    return this.makeAt(start, TokenType.HexColor, lexeme, lexeme);
  }

  // ─────────────────────────────────────────────────────────────
  //  Strings (with interpolation)
  // ─────────────────────────────────────────────────────────────

  /**
   * Consume the opening quote(s) and decide single- vs triple-quoted.
   * Triple-quoted strings are scanned eagerly (we have no need for
   * nested injections inside them in v2, but we still respect `{expr}`).
   * Single-quoted strings push String mode and let the per-mode scanner
   * emit StringChunk / InjectStart / InjectEnd / StringLiteral as
   * appropriate.
   */
  private scanStringOpener(start: SourcePosition): Token {
    this.advance(); // first '"'
    if (this.peekChar() === '"' && this.peekCharAt(1) === '"') {
      this.advance(); // second '"'
      this.advance(); // third '"'
      return this.scanTripleString(start);
    }
    // Single-quoted: enter String mode, then immediately scan the body.
    this.modes.push(LexerMode.String);
    return this.scanInString(start, /* isFirstChunk */ true);
  }

  /**
   * Triple-quoted string. Body runs until the next `"""`. We currently
   * tokenise the whole thing as a single StringLiteral with literal
   * whitespace preserved; indentation stripping is a Phase 2 parser
   * concern (the parser has the layout info to do it deterministically).
   * Injections inside triple strings are supported via the same chunk
   * mechanism as single-quoted strings.
   */
  private scanTripleString(start: SourcePosition): Token {
    const buffer: string[] = [];
    const lexBuffer: string[] = ['"""'];
    while (!this.isAtEnd()) {
      // Check for closing """
      if (
        this.peekChar() === '"' &&
        this.peekCharAt(1) === '"' &&
        this.peekCharAt(2) === '"'
      ) {
        this.advance();
        this.advance();
        this.advance();
        lexBuffer.push('"""');
        return this.makeAt(
          start,
          TokenType.StringLiteral,
          lexBuffer.join(""),
          buffer.join(""),
        );
      }
      const ch = this.peekChar();
      buffer.push(ch);
      lexBuffer.push(ch);
      this.advance();
    }
    // Unterminated.
    this.diag.error({
      code: "MOD-L005",
      message: "Unterminated multi-line string. Missing closing '\"\"\"'.",
      span: this.spanFrom(start),
      file: this.source.path,
    });
    return this.makeAt(
      start,
      TokenType.StringLiteral,
      lexBuffer.join(""),
      buffer.join(""),
    );
  }

  /**
   * Per-call entry to scanning inside String mode. Emits one of:
   *  - StringLiteral (when the *entire* string body is a single chunk
   *    with no injections — the convenience emission)
   *  - StringChunk (when injections split the string into pieces)
   *  - InjectStart (when `{` opens an injection — also pushes Injection mode)
   *
   * `isFirstChunk` distinguishes the call coming from scanStringOpener
   * (which means we haven't split yet, so closing with `"` emits
   * StringLiteral) from a subsequent call after we've already emitted a
   * StringChunk / InjectEnd (which means closing with `"` emits StringChunk).
   *
   * `startArg` anchors the span at the opening `"` for the first chunk;
   * subsequent calls anchor at the current scan position.
   */
  private scanInString(startArg?: SourcePosition, isFirstChunk = false): Token {
    const start = startArg ?? this.position();
    const lexBuffer: string[] = startArg ? ['"'] : [];
    const valueBuffer: string[] = [];

    while (!this.isAtEnd()) {
      const ch = this.peekChar();
      if (ch === '"') {
        // End of string — consume closing quote, pop mode, emit final chunk.
        this.advance();
        lexBuffer.push('"');
        this.modes.pop();
        const type = isFirstChunk ? TokenType.StringLiteral : TokenType.StringChunk;
        return this.makeAt(start, type, lexBuffer.join(""), valueBuffer.join(""));
      }
      if (ch === "{") {
        // Inline injection inside a string. If we have any literal
        // content buffered, emit it as a StringChunk and let the next
        // scanOne() pick up the InjectStart. If we don't (e.g. `{x}`
        // at the very start of the string body), still emit an empty
        // StringChunk to anchor positions for tooling — but only when
        // we have a span (the opening `"`) to anchor to.
        if (valueBuffer.length > 0 || isFirstChunk) {
          return this.makeAt(
            start,
            TokenType.StringChunk,
            lexBuffer.join(""),
            valueBuffer.join(""),
          );
        }
        // No buffered chunk and not the opening anchor — emit InjectStart now.
        this.advance(); // '{'
        this.modes.push(LexerMode.Injection);
        this.injectionDepth.push(1);
        return this.makeAt(start, TokenType.InjectStart, "{", "{");
      }
      if (ch === "\\") {
        const escStart = this.offset;
        this.advance(); // consume backslash
        if (this.isAtEnd()) break;
        const esc = this.peekChar();
        this.advance(); // consume the escaped char
        const decoded = decodeEscape(esc);
        if (decoded === null) {
          this.diag.warn({
            code: "MOD-L006",
            message: `Unknown string escape '\\${esc}'.`,
            span: { start: this.positionAt(escStart), end: this.position() },
            file: this.source.path,
          });
          lexBuffer.push("\\" + esc);
          valueBuffer.push(esc);
        } else {
          lexBuffer.push("\\" + esc);
          valueBuffer.push(decoded);
        }
        continue;
      }
      if (ch === "\n") {
        this.diag.error({
          code: "MOD-L007",
          message:
            "Unterminated string literal. Single-quoted strings cannot span lines (use triple-quoted '\"\"\"' for multi-line).",
          span: this.spanFrom(start),
          file: this.source.path,
        });
        this.modes.pop();
        const type = isFirstChunk ? TokenType.StringLiteral : TokenType.StringChunk;
        return this.makeAt(start, type, lexBuffer.join(""), valueBuffer.join(""));
      }
      lexBuffer.push(ch);
      valueBuffer.push(ch);
      this.advance();
    }
    // EOF inside string.
    this.diag.error({
      code: "MOD-L007",
      message: "Unterminated string literal.",
      span: this.spanFrom(start),
      file: this.source.path,
    });
    this.modes.pop();
    const type = isFirstChunk ? TokenType.StringLiteral : TokenType.StringChunk;
    return this.makeAt(start, type, lexBuffer.join(""), valueBuffer.join(""));
  }

  // ─────────────────────────────────────────────────────────────
  //  Native body (verbatim raw capture)
  // ─────────────────────────────────────────────────────────────

  private scanNativeBody(): Token {
    const start = this.position();
    const lexBuffer: string[] = [];
    let depth = 1; // the opening `{` was already consumed as LBrace
    while (!this.isAtEnd()) {
      const ch = this.peekChar();
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          // Emit body, pop mode. The next call will see the `}` and
          // emit RBrace.
          this.modes.pop();
          return this.makeAt(
            start,
            TokenType.NativeBody,
            lexBuffer.join(""),
            lexBuffer.join(""),
          );
        }
      }
      lexBuffer.push(ch);
      this.advance();
    }
    // Unbalanced native block.
    this.diag.error({
      code: "MOD-L008",
      message: "Unbalanced 'Native<…> { … }' block. Missing closing '}'.",
      span: this.spanFrom(start),
      file: this.source.path,
    });
    this.modes.pop();
    this.exhausted = true;
    return this.makeAt(
      start,
      TokenType.NativeBody,
      lexBuffer.join(""),
      lexBuffer.join(""),
    );
  }

  // ─────────────────────────────────────────────────────────────
  //  Trivia: whitespace, newlines, comments
  // ─────────────────────────────────────────────────────────────

  /**
   * Consume any whitespace, newline, or comment at the current offset.
   * Returns a trivia token to emit (if any) — when null, the caller
   * proceeds to scan the next real token. Multiple trivia kinds may be
   * present; this routine handles ONE at a time and lets the caller
   * loop (it loops internally for whitespace though).
   */
  private scanTrivia(): Token | null {
    if (this.isAtEnd()) return null;
    const ch = this.peekChar();
    // Horizontal whitespace.
    if (ch === " " || ch === "\t") {
      const start = this.position();
      const startOffset = this.offset;
      while (!this.isAtEnd()) {
        const c = this.peekChar();
        if (c !== " " && c !== "\t") break;
        this.advance();
      }
      const lex = this.text.slice(startOffset, this.offset);
      return this.makeAt(start, TokenType.Whitespace, lex, lex);
    }
    // Newline.
    if (ch === "\n") {
      const start = this.position();
      this.advance();
      return this.makeAt(start, TokenType.Newline, "\n", "\n");
    }
    // Line / block comment.
    if (ch === "/" && this.peekCharAt(1) === "/") {
      return this.scanLineComment();
    }
    if (ch === "/" && this.peekCharAt(1) === "*") {
      return this.scanBlockComment();
    }
    return null;
  }

  private scanLineComment(): Token {
    const start = this.position();
    const startOffset = this.offset;
    this.advance(); // '/'
    this.advance(); // '/'
    while (!this.isAtEnd() && this.peekChar() !== "\n") this.advance();
    const lex = this.text.slice(startOffset, this.offset);
    return this.makeAt(start, TokenType.CommentLine, lex, lex.slice(2));
  }

  private scanBlockComment(): Token {
    const start = this.position();
    const startOffset = this.offset;
    this.advance(); // '/'
    this.advance(); // '*'
    while (!this.isAtEnd()) {
      if (this.peekChar() === "*" && this.peekCharAt(1) === "/") {
        this.advance();
        this.advance();
        const lex = this.text.slice(startOffset, this.offset);
        return this.makeAt(start, TokenType.CommentBlock, lex, lex.slice(2, -2));
      }
      this.advance();
    }
    this.diag.error({
      code: "MOD-L009",
      message: "Unterminated block comment. Missing closing '*/'.",
      span: this.spanFrom(start),
      file: this.source.path,
    });
    const lex = this.text.slice(startOffset, this.offset);
    return this.makeAt(start, TokenType.CommentBlock, lex, lex.slice(2));
  }

  // ─────────────────────────────────────────────────────────────
  //  Position / read helpers
  // ─────────────────────────────────────────────────────────────

  private isAtEnd(): boolean {
    return this.offset >= this.text.length;
  }

  private peekChar(): string {
    return this.text[this.offset] ?? "";
  }

  private peekCharAt(rel: number): string {
    return this.text[this.offset + rel] ?? "";
  }

  private advance(): string {
    if (this.isAtEnd()) return "";
    const ch = this.text[this.offset]!;
    this.offset++;
    if (ch === "\n") {
      this.line++;
      this.column = 1;
    } else {
      this.column++;
    }
    return ch;
  }

  private position(): SourcePosition {
    return { line: this.line, column: this.column, offset: this.offset };
  }

  private positionAt(offset: number): SourcePosition {
    return this.source.positionAt(offset);
  }

  private spanFrom(start: SourcePosition): SourceSpan {
    return { start, end: this.position() };
  }

  // ─────────────────────────────────────────────────────────────
  //  Token construction
  // ─────────────────────────────────────────────────────────────

  private emitSingle(start: SourcePosition, type: TokenType, lexeme: string): Token {
    this.advance();
    return this.makeAt(start, type, lexeme, lexeme);
  }

  private makeAt(
    start: SourcePosition,
    type: TokenType,
    lexeme: string,
    value: string | number | boolean | null,
    keyword?: KeywordName,
  ): Token {
    return makeToken(type, lexeme, value, this.spanFrom(start), this.source.path, keyword);
  }

  private eofToken(): Token {
    this.exhausted = true;
    const pos = this.position();
    return makeToken(TokenType.Eof, "", null, { start: pos, end: pos }, this.source.path);
  }
}

/** Trivia kinds filtered out of `scanAll()` unless `keepTrivia` is true. */
function isTrivia(type: TokenType): boolean {
  return (
    type === TokenType.Whitespace ||
    type === TokenType.Newline ||
    type === TokenType.CommentLine ||
    type === TokenType.CommentBlock
  );
}

function decodeEscape(ch: string): string | null {
  switch (ch) {
    case "n":
      return "\n";
    case "t":
      return "\t";
    case "r":
      return "\r";
    case "0":
      return "\0";
    case "\\":
      return "\\";
    case '"':
      return '"';
    case "{":
      return "{";
    case "}":
      return "}";
    default:
      return null;
  }
}
