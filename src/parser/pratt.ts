/**
 * Pratt expression parser.
 *
 * The expression parser is deliberately small: it understands atoms,
 * prefix operators, postfix-ish forms (`.`, `()`, `[]`, `?`), and
 * symbolic / keyword infix operators. Statement-level operators
 * (`<-`, `->`, `<:`, `::`, `<->`) are NEVER consumed here.
 *
 * The parser is built on top of a TokenCursor (parser.ts) so the same
 * lookahead helpers are shared across declarations, statements, and
 * expressions.
 */

import type { TokenCursor } from "./parser.js";
import type {
  ArrayLit,
  BoolLit,
  CallArg,
  Conditional,
  Expr,
  HexColorLit,
  Identifier,
  InterpolatedStringLit,
  NativeBridge,
  NoneLit,
  NumberLit,
  ObjectEntry,
  ObjectLit,
  ParenExpr,
  StringChunkPart,
  StringLit,
} from "../ast/nodes.js";
import { TokenType, type Token } from "../lexer/tokens.js";
import type { SourceSpan } from "../utils/source.js";
import {
  infixInfo,
  keywordInfixInfo,
  prefixInfo,
  NOT_PREFIX_BP,
} from "./precedence.js";

/** Parse a Modra expression. Caller's threshold is `minBp`. */
export function parseExpression(cur: TokenCursor, minBp = 0): Expr {
  let left = parsePrefix(cur);

  while (true) {
    const tok = cur.peek();
    // Postfix forms only apply to "callable" expressions: identifiers,
    // member-access chains, parenthesised expressions, prior calls,
    // and prior indices. Bare literals (numbers, strings, hex colours)
    // never accept postfix operators — that lets the grammar reuse
    // `(` as a trailing attr-block in declarative contexts.
    const canPostfix = isPostfixTarget(left);
    if (canPostfix && tok.type === TokenType.Dot) {
      cur.next();
      const property = expectIdentifier(cur, "Expected property name after '.'.");
      left = {
        kind: "Member",
        object: left,
        property,
        span: mergeSpans(left.span, property.span),
      };
      continue;
    }
    if (canPostfix && tok.type === TokenType.LParen) {
      // Don't extend into a call when the parens clearly open a
      // declarative block: e.g. `match X (` followed by `case`, or
      // `Style: S (` followed by a member-decl. We detect this by
      // peeking one token past the `(`.
      const after = cur.peek(1);
      const isDeclBlock =
        after.type === TokenType.Keyword &&
        (after.keyword === "case" || after.keyword === "otherwise");
      if (isDeclBlock) break;
      const args = parseCallArgs(cur);
      const end = cur.previous().span.end;
      left = {
        kind: "Call",
        callee: left,
        args,
        span: { start: left.span.start, end },
      };
      continue;
    }
    if (canPostfix && tok.type === TokenType.LBracket) {
      cur.next();
      const indexExpr = parseExpression(cur, 0);
      const close = cur.consume(
        TokenType.RBracket,
        "Expected ']' to close index expression.",
      );
      left = {
        kind: "Index",
        object: left,
        index: indexExpr,
        span: { start: left.span.start, end: close.span.end },
      };
      continue;
    }
    if (tok.type === TokenType.Question) {
      // Postfix `?` marks the value as optional — represent as
      // unary Conditional with no alternate.
      cur.next();
      // Treat `x?` as `x` for now; Phase 3 lifts this into the type
      // system. Encode by wrapping in a Conditional with `none` alternate.
      // For Phase 2 we lose nothing if we represent it as a flag on the
      // expression's parent — but since our AST doesn't carry it, we
      // synthesise an Identifier("none") alternate to keep the shape
      // expressive. The simplest faithful encoding is a binary "is" ...
      // actually, the cleanest path is to leave `?` for type positions
      // and treat a stray `?` in expression context as an error.
      cur.error("MOD-P010", "Stray '?' in expression context.", tok.span);
      continue;
    }

    // Symbolic infix?
    const info = infixInfo(tok);
    if (info) {
      if (info.bp < minBp) break;
      cur.next();
      const right = parseExpression(cur, info.assoc === "left" ? info.bp + 1 : info.bp);
      left = {
        kind: "Binary",
        operator: info.operator,
        left,
        right,
        span: mergeSpans(left.span, right.span),
      };
      continue;
    }

    // Keyword infix (and/or/xor/is/in/contains/...)
    if (tok.type === TokenType.Keyword && typeof tok.keyword === "string") {
      const name = tok.keyword;
      // `is not` two-token form.
      if (name === "is" && cur.peek(1).type === TokenType.Keyword && cur.peek(1).keyword === "not") {
        const kwInfo = keywordInfixInfo("is");
        if (!kwInfo || kwInfo.bp < minBp) break;
        cur.next();
        cur.next();
        const right = parseExpression(cur, kwInfo.bp + 1);
        left = {
          kind: "Binary",
          operator: "is not",
          left,
          right,
          span: mergeSpans(left.span, right.span),
        };
        continue;
      }
      const kwInfo = keywordInfixInfo(name);
      if (kwInfo) {
        if (kwInfo.bp < minBp) break;
        cur.next();
        const right = parseExpression(cur, kwInfo.bp + 1);
        left = {
          kind: "Binary",
          operator: kwInfo.operator,
          left,
          right,
          span: mergeSpans(left.span, right.span),
        };
        continue;
      }
    }

    break;
  }

  return left;
}

function parsePrefix(cur: TokenCursor): Expr {
  const tok = cur.peek();

  // Symbolic prefix (-, +, !).
  const pre = prefixInfo(tok);
  if (pre) {
    cur.next();
    const operand = parseExpression(cur, pre.bp);
    return {
      kind: "Unary",
      operator: pre.operator,
      operand,
      span: { start: tok.span.start, end: operand.span.end },
    };
  }

  // English prefix `not`.
  if (tok.type === TokenType.Keyword && tok.keyword === "not") {
    cur.next();
    const operand = parseExpression(cur, NOT_PREFIX_BP);
    return {
      kind: "Unary",
      operator: "not",
      operand,
      span: { start: tok.span.start, end: operand.span.end },
    };
  }

  return parseAtom(cur);
}

function parseAtom(cur: TokenCursor): Expr {
  const tok = cur.peek();

  switch (tok.type) {
    case TokenType.NumberLiteral: {
      cur.next();
      const lit: NumberLit = {
        kind: "NumberLit",
        value: tok.value as number,
        raw: tok.lexeme,
        span: tok.span,
      };
      return lit;
    }
    case TokenType.StringLiteral: {
      cur.next();
      const lit: StringLit = {
        kind: "StringLit",
        value: tok.value as string,
        raw: tok.lexeme,
        span: tok.span,
      };
      return lit;
    }
    case TokenType.StringChunk:
      return parseInterpolatedString(cur);
    case TokenType.BoolLiteral: {
      cur.next();
      const lit: BoolLit = {
        kind: "BoolLit",
        value: tok.value as boolean,
        span: tok.span,
      };
      return lit;
    }
    case TokenType.NoneLiteral: {
      cur.next();
      const lit: NoneLit = { kind: "NoneLit", span: tok.span };
      return lit;
    }
    case TokenType.HexColor: {
      cur.next();
      const lit: HexColorLit = {
        kind: "HexColorLit",
        value: tok.value as string,
        span: tok.span,
      };
      return lit;
    }
    case TokenType.LParen:
      return parseParenOrTuple(cur);
    case TokenType.LBracket:
      return parseArrayLiteral(cur);
    case TokenType.LBrace:
      return parseObjectLiteral(cur);
    case TokenType.InjectStart: {
      cur.next();
      const inner = parseExpression(cur, 0);
      const end = cur.consume(
        TokenType.InjectEnd,
        "Expected '}' to close '@{ … }' injection.",
      );
      return {
        kind: "Injection",
        expression: inner,
        span: { start: tok.span.start, end: end.span.end },
      };
    }
    case TokenType.Identifier:
      return parseIdentifierExpr(cur);
    case TokenType.Keyword: {
      if (tok.keyword === "if") {
        return parseConditionalExpression(cur);
      }
      if (tok.keyword === "Native") {
        return parseNativeBridge(cur);
      }
      // For "decl-starter" keywords (Style, Component, Endpoint, …,
      // Return/Throw, control-flow heads), don't consume — leave the
      // token so the outer statement / declaration parser can recover
      // by parsing a fresh statement at this position.
      if (DECL_STARTER_KEYWORDS.has(tok.keyword!)) {
        cur.error(
          "MOD-P001",
          `Unexpected keyword '${tok.lexeme}' — expected expression.`,
          tok.span,
        );
        return errorExpr(tok.span);
      }
      cur.error("MOD-P001", `Unexpected keyword '${tok.lexeme}' in expression.`, tok.span);
      cur.next();
      return errorExpr(tok.span);
    }
    default:
      cur.error("MOD-P001", `Unexpected token '${tok.lexeme}' in expression.`, tok.span);
      cur.next();
      return errorExpr(tok.span);
  }
}

function parseIdentifierExpr(cur: TokenCursor): Expr {
  const tok = cur.next();
  const id: Identifier = {
    kind: "Identifier",
    name: tok.lexeme,
    span: tok.span,
  };
  return id;
}

function parseParenOrTuple(cur: TokenCursor): Expr {
  const open = cur.next(); // '('
  // Empty parens: () — represent as empty ParenExpr around an ErrorExpr?
  // No — there's no use for `()` as an expression in Modra. Treat as error.
  if (cur.peek().type === TokenType.RParen) {
    const close = cur.next();
    cur.error("MOD-P011", "Empty '()' is not a valid expression.", {
      start: open.span.start,
      end: close.span.end,
    });
    return errorExpr({ start: open.span.start, end: close.span.end });
  }
  const inner = parseExpression(cur, 0);
  const close = cur.consume(TokenType.RParen, "Expected ')' to close parenthesised expression.");
  const wrapped: ParenExpr = {
    kind: "ParenExpr",
    expression: inner,
    span: { start: open.span.start, end: close.span.end },
  };
  return wrapped;
}

function parseArrayLiteral(cur: TokenCursor): ArrayLit {
  const open = cur.next(); // '['
  const items: Expr[] = [];
  while (cur.peek().type !== TokenType.RBracket && cur.peek().type !== TokenType.Eof) {
    items.push(parseExpression(cur, 0));
    if (cur.peek().type === TokenType.Comma) {
      cur.next();
      continue;
    }
    break;
  }
  const close = cur.consume(TokenType.RBracket, "Expected ']' to close array literal.");
  return {
    kind: "ArrayLit",
    items,
    span: { start: open.span.start, end: close.span.end },
  };
}

function parseObjectLiteral(cur: TokenCursor): ObjectLit {
  const open = cur.next(); // '{'
  const entries: ObjectEntry[] = [];
  while (cur.peek().type !== TokenType.RBrace && cur.peek().type !== TokenType.Eof) {
    const key = expectIdentifier(cur, "Expected key name in object literal.");
    cur.consume(TokenType.Colon, "Expected ':' after object key.");
    const value = parseExpression(cur, 0);
    entries.push({
      kind: "ObjectEntry",
      key,
      value,
      span: { start: key.span.start, end: value.span.end },
    });
    if (cur.peek().type === TokenType.Comma) {
      cur.next();
      continue;
    }
    break;
  }
  const close = cur.consume(TokenType.RBrace, "Expected '}' to close object literal.");
  return {
    kind: "ObjectLit",
    entries,
    span: { start: open.span.start, end: close.span.end },
  };
}

function parseInterpolatedString(cur: TokenCursor): InterpolatedStringLit {
  const startTok = cur.peek();
  const parts: (StringChunkPart | Expr)[] = [];
  let endSpan: SourceSpan = startTok.span;

  while (true) {
    const tok = cur.peek();
    if (tok.type === TokenType.StringChunk) {
      cur.next();
      const chunk: StringChunkPart = {
        kind: "StringChunkPart",
        value: tok.value as string,
        span: tok.span,
      };
      parts.push(chunk);
      endSpan = tok.span;
      continue;
    }
    if (tok.type === TokenType.InjectStart) {
      cur.next();
      const inner = parseExpression(cur, 0);
      const close = cur.consume(
        TokenType.InjectEnd,
        "Expected '}' to close string interpolation.",
      );
      parts.push(inner);
      endSpan = close.span;
      continue;
    }
    break;
  }

  return {
    kind: "InterpolatedStringLit",
    parts,
    span: { start: startTok.span.start, end: endSpan.end },
  };
}

function parseConditionalExpression(cur: TokenCursor): Conditional {
  const ifTok = cur.next(); // 'if'
  const condition = parseExpression(cur, 0);
  cur.consume(TokenType.Keyword, "Expected 'then' after if-condition.", "then");
  const consequent = parseExpression(cur, 0);
  let alternate: Expr | null = null;
  if (
    cur.peek().type === TokenType.Keyword &&
    cur.peek().keyword === "else"
  ) {
    cur.next();
    alternate = parseExpression(cur, 0);
  }
  return {
    kind: "Conditional",
    condition,
    consequent,
    alternate,
    span: {
      start: ifTok.span.start,
      end: (alternate ?? consequent).span.end,
    },
  };
}

function parseNativeBridge(cur: TokenCursor): NativeBridge {
  const nativeTok = cur.next(); // 'Native'
  cur.consume(TokenType.LessThan, "Expected '<' after 'Native'.");
  const language = expectIdentifier(cur, "Expected target language identifier (e.g. Python, JavaScript).");
  cur.consume(TokenType.GreaterThan, "Expected '>' after Native language.");
  cur.consume(TokenType.LParen, "Expected '(' to open Native bridge declarations.");

  const inputs: Identifier[] = [];
  const outputs: Identifier[] = [];

  while (cur.peek().type !== TokenType.RParen && cur.peek().type !== TokenType.Eof) {
    const head = cur.peek();
    const direction = readBridgeDirection(head);
    if (!direction) {
      cur.error("MOD-P012", "Expected 'in:' or 'out:' in Native bridge.", head.span);
      cur.next();
      continue;
    }
    cur.next(); // consume 'in' / 'out' keyword or identifier
    cur.consume(TokenType.Colon, "Expected ':' after bridge direction.");
    while (true) {
      const id = expectIdentifier(cur, "Expected identifier in Native bridge.");
      (direction === "in" ? inputs : outputs).push(id);
      if (cur.peek().type === TokenType.Comma) {
        cur.next();
        continue;
      }
      break;
    }
    if (cur.peek().type === TokenType.Semicolon) {
      cur.next();
    }
  }
  cur.consume(TokenType.RParen, "Expected ')' to close Native bridge declarations.");
  cur.consume(TokenType.LBrace, "Expected '{' to open Native body.");
  const bodyTok = cur.peek();
  let bodyText = "";
  if (bodyTok.type === TokenType.NativeBody) {
    bodyText = bodyTok.value as string;
    cur.next();
  }
  const close = cur.consume(TokenType.RBrace, "Expected '}' to close Native body.");
  return {
    kind: "NativeBridge",
    language,
    inputs,
    outputs,
    body: bodyText,
    span: { start: nativeTok.span.start, end: close.span.end },
  };
}

function readBridgeDirection(tok: Token): "in" | "out" | null {
  if (tok.type === TokenType.Keyword) {
    if (tok.keyword === "in") return "in";
  }
  if (tok.type === TokenType.Identifier) {
    if (tok.lexeme === "in") return "in";
    if (tok.lexeme === "out") return "out";
  }
  return null;
}

function parseCallArgs(cur: TokenCursor): CallArg[] {
  cur.next(); // '('
  const args: CallArg[] = [];
  while (cur.peek().type !== TokenType.RParen && cur.peek().type !== TokenType.Eof) {
    args.push(parseCallArg(cur));
    if (cur.peek().type === TokenType.Comma) {
      cur.next();
      continue;
    }
    break;
  }
  cur.consume(TokenType.RParen, "Expected ')' to close argument list.");
  return args;
}

function parseCallArg(cur: TokenCursor): CallArg {
  // Named arg: `Name: value` — but the bare `name: value` form is
  // overloaded for object literals, attribute lines, etc.
  // Inside a `(... , ...)` call arg list we use: Identifier ':' value -> named.
  if (
    cur.peek().type === TokenType.Identifier &&
    cur.peek(1).type === TokenType.Colon
  ) {
    const id = expectIdentifier(cur, "Expected argument name.");
    cur.next(); // ':'
    const value = parseExpression(cur, 0);
    return {
      kind: "CallArg",
      name: id,
      value,
      span: { start: id.span.start, end: value.span.end },
    };
  }
  const value = parseExpression(cur, 0);
  return {
    kind: "CallArg",
    name: null,
    value,
    span: value.span,
  };
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

export function expectIdentifier(cur: TokenCursor, message: string): Identifier {
  const tok = cur.peek();
  if (tok.type === TokenType.Identifier) {
    cur.next();
    return { kind: "Identifier", name: tok.lexeme, span: tok.span };
  }
  // Lenient: accept a keyword token used as identifier in declarative
  // contexts (e.g. column called `String:`). The parser caller decides
  // whether that's semantically OK.
  if (tok.type === TokenType.Keyword) {
    cur.next();
    return { kind: "Identifier", name: tok.lexeme, span: tok.span };
  }
  cur.error("MOD-P002", message, tok.span);
  return { kind: "Identifier", name: "<error>", span: tok.span };
}

function mergeSpans(a: SourceSpan, b: SourceSpan): SourceSpan {
  return { start: a.start, end: b.end };
}

/**
 * Keywords that should never be consumed mid-expression because they
 * unambiguously start a fresh declaration or statement. Leaving them
 * in place lets the outer parser recover cleanly.
 */
const DECL_STARTER_KEYWORDS = new Set<string>([
  "Style",
  "Component",
  "Endpoint",
  "Action",
  "Database",
  "Table",
  "Type",
  "Module",
  "Schema",
  "using",
  "Return",
  "Throw",
  "Yield",
  "Break",
  "Continue",
  "if",
  "while",
  "forEach",
  "loop",
  "repeat",
  "match",
  "attempt",
  "transaction",
  "parallel",
  "sequence",
  "require",
  "assert",
  "expect",
  "On",
]);

function isPostfixTarget(expr: Expr): boolean {
  switch (expr.kind) {
    case "Identifier":
    case "Member":
    case "Call":
    case "Index":
    case "ParenExpr":
    case "Injection":
    case "NativeBridge":
      return true;
    default:
      return false;
  }
}

function errorExpr(span: SourceSpan): Expr {
  return { kind: "ErrorExpr", message: "expression error", span };
}
