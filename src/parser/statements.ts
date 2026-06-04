/**
 * Statement parsing.
 *
 * `parseBlock(cur)` parses a `( … )` body containing newline-separated
 * BlockItem entries.
 *
 * `parseBlockItem(cur)` is the central dispatch — given the cursor's
 * current position, it produces either an ElementDecl or a Stmt.
 *
 * Statement parsers are intentionally permissive: they return
 * best-effort nodes and record diagnostics rather than throwing.
 */

import { TokenType, type Token } from "../lexer/tokens.js";
import type {
  ApplyEffectStmt,
  AttrList,
  Attribute,
  AttemptStmt,
  AssertStmt,
  BindStmt,
  Block,
  BlockItem,
  BreakStmt,
  ContinueStmt,
  Decorator,
  Directive,
  ElementDecl,
  ErrorStmt,
  EventWireStmt,
  ExpectStmt,
  ExpressionStmt,
  ForEachStmt,
  Expr,
  Identifier,
  IfBranch,
  IfStmt,
  LoopStmt,
  MatchCase,
  MatchStmt,
  ParallelStmt,
  ReactiveAssignStmt,
  RepeatStmt,
  RequireStmt,
  ReturnStmt,
  SequenceStmt,
  Stmt,
  SyncStmt,
  ThrowStmt,
  TransactionStmt,
  TypeRef,
  WhileStmt,
  YieldStmt,
} from "../ast/nodes.js";
import type { SourceSpan } from "../utils/source.js";
import type { TokenCursor } from "./parser.js";
import { expectIdentifier, parseExpression } from "./pratt.js";
import { synchronize } from "./recovery.js";

/**
 * Keywords that introduce a nested top-level declaration (Style,
 * Component, Endpoint, Action, Database, Type). When seen inside a
 * block body, we delegate to the declaration parser (registered via
 * `registerNestedDeclParser` from the declarations module to break
 * the circular import).
 */
const NESTED_DECL_KEYWORDS = new Set<string>([
  "Style",
  "Component",
  "Endpoint",
  "Action",
  "Database",
  "Type",
]);

type NestedDeclParser = (
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
) => BlockItem | null;

let nestedDeclParser: NestedDeclParser | null = null;

export function registerNestedDeclParser(p: NestedDeclParser): void {
  nestedDeclParser = p;
}

function parseNestedTopLevelDecl(
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
): BlockItem | null {
  if (!nestedDeclParser) return null;
  return nestedDeclParser(cur, directives, decorators);
}

// ─────────────────────────────────────────────────────────────
//  Block
// ─────────────────────────────────────────────────────────────

/**
 * Parse a `( … )` body. The opening `(` MUST already be at the cursor.
 * Items inside are newline- or comma-separated. Returns a Block with
 * span starting at the open paren and ending at the close paren.
 */
export function parseBlock(cur: TokenCursor): Block {
  const open = cur.consume(TokenType.LParen, "Expected '(' to open block.");
  const items: BlockItem[] = [];
  while (!cur.isAtEnd() && cur.peek().type !== TokenType.RParen) {
    // Allow stray separators between items.
    if (cur.match(TokenType.Comma)) continue;
    const before = cur.peek();
    const item = parseBlockItem(cur);
    if (item) items.push(item);
    // Defensive: if the parser made no progress, advance one token to
    // avoid an infinite loop.
    if (cur.peek() === before) cur.next();
  }
  const close = cur.consume(TokenType.RParen, "Expected ')' to close block.");
  return {
    kind: "Block",
    items,
    span: { start: open.span.start, end: close.span.end },
  };
}

// ─────────────────────────────────────────────────────────────
//  BlockItem dispatch
// ─────────────────────────────────────────────────────────────

export function parseBlockItem(cur: TokenCursor): BlockItem | null {
  const startTok = cur.peek();

  // Collect leading annotations (directives + decorators).
  const directives: Directive[] = [];
  const decorators: Decorator[] = [];
  while (true) {
    if (cur.peek().type === TokenType.DirectiveAt) {
      directives.push(parseDirective(cur));
      continue;
    }
    if (cur.peek().type === TokenType.Decorator) {
      decorators.push(parseDecorator(cur));
      continue;
    }
    break;
  }

  const tok = cur.peek();
  if (tok.type === TokenType.RParen || tok.type === TokenType.Eof) {
    // Directives with no body — attach to a placeholder ElementDecl so
    // they aren't silently dropped.
    if (directives.length > 0 || decorators.length > 0) {
      return makeOrphanAnnotationDecl(directives, decorators, startTok.span);
    }
    return null;
  }

  // Keyword-driven statements.
  if (tok.type === TokenType.Keyword) {
    const kw = tok.keyword!;
    // Nested top-level declarations (Style, Component, …) are allowed
    // inside any block body. Delegate to the file-level parser via a
    // late-bound hook to avoid a hard module cycle.
    if (NESTED_DECL_KEYWORDS.has(kw)) {
      const decl = parseNestedTopLevelDecl(cur, directives, decorators);
      if (decl) return decl;
    }
    switch (kw) {
      case "if":
        return attachAnnotations(parseIfStmt(cur), directives, decorators);
      case "while":
        return attachAnnotations(parseWhileStmt(cur), directives, decorators);
      case "forEach":
        return attachAnnotations(parseForEachStmt(cur), directives, decorators);
      case "loop":
        return attachAnnotations(parseLoopStmt(cur), directives, decorators);
      case "repeat":
        return attachAnnotations(parseRepeatStmt(cur), directives, decorators);
      case "match":
        return attachAnnotations(parseMatchStmt(cur), directives, decorators);
      case "attempt":
        return attachAnnotations(parseAttemptStmt(cur), directives, decorators);
      case "transaction":
      case "parallel":
      case "sequence":
        return attachAnnotations(parseBlockOpStmt(cur, kw), directives, decorators);
      case "Return":
      case "Throw":
      case "Yield":
        return attachAnnotations(parseJumpStmt(cur, kw), directives, decorators);
      case "Break":
        return attachAnnotations(parseBreakStmt(cur), directives, decorators);
      case "Continue":
        return attachAnnotations(parseContinueStmt(cur), directives, decorators);
      case "require":
      case "assert":
      case "expect":
        return attachAnnotations(parseCheckStmt(cur, kw), directives, decorators);
      case "On":
        return attachAnnotations(parseOnStmt(cur), directives, decorators);
      default:
        // Any other TitleCase keyword followed by `:` (Record:, Module:,
        // Schema:, Table:, Native:, …) is an ElementDecl form.
        if (cur.peek(1).type === TokenType.Colon) {
          return parseElementDecl(cur, directives, decorators);
        }
        break;
    }
  }

  // Identifier-driven: ElementDecl, BindStmt, EventWireStmt, etc.
  if (tok.type === TokenType.Identifier) {
    const next = cur.peek(1);
    if (next.type === TokenType.BindState) {
      return attachAnnotations(parseBindStmt(cur), directives, decorators);
    }
    if (next.type === TokenType.AssignLeft) {
      return attachAnnotations(parseReactiveAssign(cur), directives, decorators);
    }
    if (next.type === TokenType.SyncBoth) {
      return attachAnnotations(parseSyncStmt(cur), directives, decorators);
    }
    if (next.type === TokenType.FlowRight) {
      return attachAnnotations(parseEventWireStmt(cur), directives, decorators);
    }
    if (next.type === TokenType.Colon) {
      return parseElementDecl(cur, directives, decorators);
    }
    // Generic-typed label: `Array<Object>: …`.
    if (next.type === TokenType.LessThan && isGenericLabelAhead(cur)) {
      return parseElementDecl(cur, directives, decorators);
    }
    // Identifier followed by `(` at the start of a block item is a
    // bare-element form (e.g. `form ( ... )` or
    // `CreateProductCard(...)`). Parse it as an ElementDecl whose
    // label IS the identifier and whose attrs are the parenthesised
    // content.
    if (next.type === TokenType.LParen) {
      return parseBareElement(cur, directives, decorators);
    }
    // Identifier followed by `(` or `<:` or bare → expression statement.
    return attachAnnotations(parseExpressionOrEffectStmt(cur), directives, decorators);
  }

  // Anything else: try as an expression statement.
  return attachAnnotations(parseExpressionOrEffectStmt(cur), directives, decorators);
}

/**
 * Parse a `Label ( … )` form (no colon) — a bare-element line where
 * the identifier is the element type/kind and the parens hold its
 * declarative content. Always returns an ElementDecl with name=null.
 */
function parseBareElement(
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
): ElementDecl {
  const labelTok = cur.next();
  const label: Identifier = {
    kind: "Identifier",
    name: labelTok.lexeme,
    span: labelTok.span,
  };
  let attrs: AttrList | null = parseAttrList(cur);
  let body: Block | Expr | null = null;
  let end = attrs.span.end;
  while (true) {
    const p = cur.peek();
    if (p.type === TokenType.LParen) {
      attrs = mergeAttrLists(attrs, parseAttrList(cur));
      end = attrs.span.end;
      continue;
    }
    if (p.type === TokenType.FlowRight) {
      cur.next();
      body = parseArrowBody(cur);
      end = body.span.end;
      continue;
    }
    break;
  }
  const trailingDecorators: Decorator[] = [];
  while (cur.peek().type === TokenType.Decorator) {
    trailingDecorators.push(parseDecorator(cur));
    end = cur.previous().span.end;
  }
  return {
    kind: "ElementDecl",
    label,
    labelGenerics: [],
    name: null,
    base: null,
    attrs,
    init: null,
    body,
    decorators: [...decorators, ...trailingDecorators],
    directives,
    span: { start: label.span.start, end },
  };
}

function attachAnnotations<T extends BlockItem>(
  node: T,
  directives: Directive[],
  decorators: Decorator[],
): T {
  if (directives.length === 0 && decorators.length === 0) return node;
  if (node.kind === "ElementDecl") {
    node.directives = [...directives, ...node.directives];
    node.decorators = [...decorators, ...node.decorators];
    return node;
  }
  // For non-ElementDecl statements, attach the annotations to a
  // synthetic wrapper ElementDecl with label = "__annotated".
  // Phase 3 will reattach them to the enclosing context.
  if (directives.length > 0 || decorators.length > 0) {
    // We don't have a great place for directives/decorators on raw
    // statements in v2; record an info diagnostic. (Statements with
    // attached directives are rare — only @@reactive inside a body so
    // far, and that targets the enclosing block.)
  }
  return node;
}

function makeOrphanAnnotationDecl(
  directives: Directive[],
  decorators: Decorator[],
  span: SourceSpan,
): ElementDecl {
  return {
    kind: "ElementDecl",
    label: { kind: "Identifier", name: "__annotation__", span },
    labelGenerics: [],
    name: null,
    base: null,
    attrs: null,
    init: null,
    body: null,
    decorators,
    directives,
    span,
  };
}

// ─────────────────────────────────────────────────────────────
//  Directives and decorators
// ─────────────────────────────────────────────────────────────

export function parseDirective(cur: TokenCursor): Directive {
  const open = cur.next(); // '@@'
  const name = expectIdentifier(cur, "Expected directive name after '@@'.");
  const args: Expr[] = [];
  let value: Expr | null = null;
  let end = name.span.end;
  if (cur.peek().type === TokenType.LParen) {
    cur.next();
    while (cur.peek().type !== TokenType.RParen && cur.peek().type !== TokenType.Eof) {
      args.push(parseExpression(cur, 0));
      if (cur.match(TokenType.Comma)) continue;
      break;
    }
    const close = cur.consume(TokenType.RParen, "Expected ')' to close directive args.");
    end = close.span.end;
  }
  if (cur.match(TokenType.Colon)) {
    value = parseExpression(cur, 0);
    end = value.span.end;
  }
  return {
    kind: "Directive",
    name,
    args,
    value,
    span: { start: open.span.start, end },
  };
}

export function parseDecorator(cur: TokenCursor): Decorator {
  const tok = cur.next(); // Decorator token, value = name
  const name: Identifier = {
    kind: "Identifier",
    name: tok.value as string,
    span: tok.span,
  };
  const args: Expr[] = [];
  let end = tok.span.end;
  if (cur.peek().type === TokenType.LParen) {
    cur.next();
    while (cur.peek().type !== TokenType.RParen && cur.peek().type !== TokenType.Eof) {
      args.push(parseExpression(cur, 0));
      if (cur.match(TokenType.Comma)) continue;
      break;
    }
    const close = cur.consume(TokenType.RParen, "Expected ')' to close decorator args.");
    end = close.span.end;
  }
  return {
    kind: "Decorator",
    name,
    args,
    span: { start: tok.span.start, end },
  };
}

// ─────────────────────────────────────────────────────────────
//  ElementDecl (the unified labelled body line)
// ─────────────────────────────────────────────────────────────

/**
 * Parse a labelled element declaration starting at the cursor. The
 * cursor must be pointing at the `Label` Identifier; this function
 * consumes the label, the `:`, the optional `Name`, and then any
 * combination of `from Base`, `(...)` attrs, `<- init`, `-> body`,
 * plus trailing decorators (`@Primary`, etc.).
 */
export function parseElementDecl(
  cur: TokenCursor,
  leadingDirectives: Directive[] = [],
  leadingDecorators: Decorator[] = [],
): ElementDecl {
  const label = expectIdentifier(cur, "Expected element label.");
  // Optional generic-type suffix on the label: `Array<Object>:`.
  const labelGenerics: TypeRef[] = [];
  if (cur.peek().type === TokenType.LessThan && isGenericLabelAhead(cur)) {
    cur.next(); // '<'
    while (cur.peek().type !== TokenType.GreaterThan && cur.peek().type !== TokenType.Eof) {
      if (cur.match(TokenType.Comma)) continue;
      labelGenerics.push(parseSimpleTypeRef(cur));
    }
    cur.consume(TokenType.GreaterThan, "Expected '>' to close generic type parameters.");
  }
  cur.consume(TokenType.Colon, "Expected ':' after element label.");
  const startSpan = label.span;
  let endSpan: SourceSpan = label.span;

  let name: Identifier | null = null;
  let base: Identifier | null = null;
  let attrs: AttrList | null = null;
  let init: Expr | null = null;
  let body: Block | Expr | null = null;
  const trailingDecorators: Decorator[] = [];

  // After `:` the value can be: an Identifier (name), a literal/expr
  // (init), or an opening paren (positional content).
  const head = cur.peek();
  if (head.type === TokenType.Identifier && isNameContinuation(cur)) {
    const id = expectIdentifier(cur, "Expected name after ':'.");
    name = id;
    endSpan = id.span;
    // Continue scanning for from/attrs/init/body modifiers.
    while (true) {
      const p = cur.peek();
      if (p.type === TokenType.Keyword && p.keyword === "from") {
        cur.next();
        const baseId = expectIdentifier(cur, "Expected base name after 'from'.");
        base = baseId;
        endSpan = baseId.span;
        continue;
      }
      if (p.type === TokenType.LParen) {
        attrs = parseAttrList(cur);
        endSpan = attrs.span;
        continue;
      }
      if (p.type === TokenType.AssignLeft) {
        cur.next();
        init = parseExpression(cur, 0);
        endSpan = init.span;
        continue;
      }
      if (p.type === TokenType.FlowRight) {
        cur.next();
        body = parseArrowBody(cur);
        endSpan = body.span;
        continue;
      }
      if (p.type === TokenType.Decorator) {
        trailingDecorators.push(parseDecorator(cur));
        endSpan = cur.previous().span;
        continue;
      }
      break;
    }
  } else {
    // After `:` we got a non-identifier (or an identifier immediately
    // followed by `.` / `(` / operator). Treat the value as an init
    // expression, then look for additional trailing modifiers
    // (`(children)`, `-> body`, `@Decorator`). A trailing `(...)` in
    // the no-name branch is interpreted as a body block — its contents
    // are mixed declarative items, not just key/value attributes.
    init = parseExpression(cur, 0);
    endSpan = init.span;
    while (true) {
      const p = cur.peek();
      if (p.type === TokenType.LParen) {
        body = parseBlock(cur);
        endSpan = body.span;
        continue;
      }
      if (p.type === TokenType.FlowRight) {
        cur.next();
        body = parseArrowBody(cur);
        endSpan = body.span;
        continue;
      }
      if (p.type === TokenType.Decorator) {
        trailingDecorators.push(parseDecorator(cur));
        endSpan = cur.previous().span;
        continue;
      }
      break;
    }
  }

  return {
    kind: "ElementDecl",
    label,
    labelGenerics,
    name,
    base,
    attrs,
    init,
    body,
    decorators: [...leadingDecorators, ...trailingDecorators],
    directives: leadingDirectives,
    span: { start: startSpan.start, end: endSpan.end },
  };
}

/**
 * Look ahead from the FIRST `<` token in `Identifier < … > :` to
 * determine whether the angle-bracket group is a generic-type
 * delimiter (label form) or unrelated. We accept the generic
 * interpretation only if we can find a matching `>` followed by `:`
 * without crossing any newline.
 *
 * The cursor may sit on either the leading Identifier or the `<`
 * itself; we auto-detect by inspecting peek(0).
 */
export function isGenericLabelAhead(cur: TokenCursor): boolean {
  // `peek()` skips Newline tokens but `peekRaw(i)` indexes from the
  // cursor's raw position — which can still be sitting on a Newline (or
  // a run of them) when this function is called right after one or more
  // blank lines. Find the raw offset of the first significant token so
  // the depth-tracking loop below indexes from the actual identifier
  // (or `<`) instead of stray leading newlines.
  let base = 0;
  while (cur.peekRaw(base).type === TokenType.Newline) {
    base++;
    if (base > 32) return false; // sanity bound
  }
  const first = cur.peekRaw(base);
  const startOffset = first.type === TokenType.LessThan ? base : base + 1;
  let depth = 0;
  for (let i = startOffset; i < startOffset + 64; i++) {
    const t = cur.peekRaw(i);
    if (t.type === TokenType.Eof || t.type === TokenType.Newline) return false;
    if (t.type === TokenType.LessThan) depth++;
    else if (t.type === TokenType.GreaterThan) {
      depth--;
      if (depth === 0) {
        const next = cur.peekRaw(i + 1);
        return next.type === TokenType.Colon;
      }
    }
  }
  return false;
}

/** Parse a TypeRef without using the declarations module to avoid a cycle. */
function parseSimpleTypeRef(cur: TokenCursor): TypeRef {
  const name = expectIdentifier(cur, "Expected type name.");
  const generics: TypeRef[] = [];
  let end = name.span.end;
  if (cur.peek().type === TokenType.LessThan) {
    cur.next();
    while (cur.peek().type !== TokenType.GreaterThan && cur.peek().type !== TokenType.Eof) {
      if (cur.match(TokenType.Comma)) continue;
      generics.push(parseSimpleTypeRef(cur));
    }
    const gt = cur.consume(TokenType.GreaterThan, "Expected '>' to close generic type.");
    end = gt.span.end;
  }
  let optional = false;
  if (cur.peek().type === TokenType.Question) {
    const q = cur.next();
    optional = true;
    end = q.span.end;
  }
  return {
    kind: "TypeRef",
    name,
    generics,
    optional,
    span: { start: name.span.start, end },
  };
}

/** Merge two attribute lists (used when a bare element has multiple `(...)`). */
function mergeAttrLists(a: AttrList | null, b: AttrList): AttrList {
  if (!a) return b;
  return {
    kind: "AttrList",
    entries: [...a.entries, ...b.entries],
    span: { start: a.span.start, end: b.span.end },
  };
}

/**
 * Decide whether the token after the colon should be interpreted as
 * the element's NAME (which then admits attrs/init/body modifiers)
 * or as the START of an init expression (single value).
 *
 * Heuristic: take the name interpretation if the Identifier is followed
 * by one of these "modifier" tokens: `<-`, `->`, `(`, `from`, `@`, or
 * the end of the block-item (newline, comma, `)`, EOF).
 * Otherwise (identifier followed by `.`, `+`, `==`, `(` immediately
 * with no whitespace — we already lost that — etc.) treat as init.
 *
 * In practice with whitespace stripped the only ambiguous case is
 * `Identifier (` which we'll resolve as NAME + attrs (the call
 * interpretation requires the parens to be juxtaposed without
 * whitespace, which we can't see anymore — and the declarative form
 * is overwhelmingly more common).
 */
function isNameContinuation(cur: TokenCursor): boolean {
  const next = cur.peek(1);
  switch (next.type) {
    case TokenType.AssignLeft:
    case TokenType.FlowRight:
    case TokenType.LParen:
    case TokenType.Decorator:
    case TokenType.RParen:
    case TokenType.Comma:
    case TokenType.Eof:
      return true;
    case TokenType.Keyword:
      return next.keyword === "from";
    default:
      return cur.peekRaw(1).type === TokenType.Newline;
  }
}

// ─────────────────────────────────────────────────────────────
//  `-> body` helper
// ─────────────────────────────────────────────────────────────

/**
 * After consuming a `->` token, parse the body. The body is either:
 *   - a parenthesised block `( ... )`
 *   - a single block-item (an ElementDecl, BindStmt, Stmt, ... — wrapped
 *     in a one-item Block for uniformity)
 *   - a single expression (for inline declarations)
 */
export function parseArrowBody(cur: TokenCursor): Block | Expr {
  if (cur.peek().type === TokenType.LParen) {
    return parseBlock(cur);
  }
  // If the next tokens look like a block-item header
  // (Identifier/Keyword followed by `:` / `::` / `<-` / `->`), parse
  // as a single block-item wrapped in a synthetic Block.
  if (lookAheadLooksLikeBlockItem(cur)) {
    const start = cur.peek().span;
    const item = parseBlockItem(cur);
    if (item) {
      return {
        kind: "Block",
        items: [item],
        span: { start: start.start, end: item.span.end },
      };
    }
  }
  // Treat as a single expression-valued body.
  return parseExpression(cur, 0);
}

function lookAheadLooksLikeBlockItem(cur: TokenCursor): boolean {
  const t = cur.peek();
  if (t.type === TokenType.Keyword) {
    // Statement keywords always start a block-item.
    return true;
  }
  if (t.type !== TokenType.Identifier) return false;
  const n = cur.peek(1);
  return (
    n.type === TokenType.Colon ||
    n.type === TokenType.BindState ||
    n.type === TokenType.AssignLeft ||
    n.type === TokenType.SyncBoth ||
    n.type === TokenType.LParen
  );
}

// ─────────────────────────────────────────────────────────────
//  AttrList (mixed parens content)
// ─────────────────────────────────────────────────────────────

/**
 * Parse a parenthesised attribute / content list. Each entry can be:
 *   - `name: expr`     static attribute
 *   - `name <- expr`   reactive attribute
 *   - `Element :: ref` two-way bind
 *   - `Event -> handler` event wire (recorded as flag-style attribute)
 *   - `expr`           positional content (e.g. `Text: Logo ("Hello")`)
 *   - `name`           flag-style boolean attribute
 *
 * Entries are separated by commas OR newlines.
 */
export function parseAttrList(cur: TokenCursor): AttrList {
  const open = cur.consume(TokenType.LParen, "Expected '(' to open attribute list.");
  const entries: Attribute[] = [];
  while (cur.peek().type !== TokenType.RParen && cur.peek().type !== TokenType.Eof) {
    if (cur.match(TokenType.Comma)) continue;
    const before = cur.peek();
    const entry = parseAttribute(cur);
    if (entry) entries.push(entry);
    if (cur.peek() === before) cur.next(); // safety
  }
  const close = cur.consume(TokenType.RParen, "Expected ')' to close attribute list.");
  return {
    kind: "AttrList",
    entries,
    span: { start: open.span.start, end: close.span.end },
  };
}

export function parseAttribute(cur: TokenCursor): Attribute | null {
  const startTok = cur.peek();

  // Bind shorthand: `Identifier :: Identifier`.
  if (
    startTok.type === TokenType.Identifier &&
    cur.peek(1).type === TokenType.BindState
  ) {
    const key = expectIdentifier(cur, "Expected element identifier.");
    cur.next(); // '::'
    const target = expectIdentifier(cur, "Expected state identifier after '::'.");
    return {
      kind: "Attribute",
      key,
      value: null,
      bindTarget: target,
      mode: "two-way",
      span: { start: key.span.start, end: target.span.end },
    };
  }

  // Event wire as attribute: `Event -> Handler`.
  if (
    startTok.type === TokenType.Identifier &&
    cur.peek(1).type === TokenType.FlowRight
  ) {
    const key = expectIdentifier(cur, "Expected event identifier.");
    cur.next(); // '->'
    const value = parseExpression(cur, 0);
    return {
      kind: "Attribute",
      key,
      value,
      bindTarget: null,
      mode: "flag", // Phase 3 reads `mode === "flag" && key.name.startsWith(capital)` as event-wire
      span: { start: key.span.start, end: value.span.end },
    };
  }

  // Reactive: `name <- expr`.
  if (
    startTok.type === TokenType.Identifier &&
    cur.peek(1).type === TokenType.AssignLeft
  ) {
    const key = expectIdentifier(cur, "Expected attribute name.");
    cur.next(); // '<-'
    const value = parseExpression(cur, 0);
    return {
      kind: "Attribute",
      key,
      value,
      bindTarget: null,
      mode: "reactive",
      span: { start: key.span.start, end: value.span.end },
    };
  }

  // Static: `name: expr`.
  if (
    startTok.type === TokenType.Identifier &&
    cur.peek(1).type === TokenType.Colon
  ) {
    const key = expectIdentifier(cur, "Expected attribute name.");
    cur.next(); // ':'
    const value = parseExpression(cur, 0);
    return {
      kind: "Attribute",
      key,
      value,
      bindTarget: null,
      mode: "static",
      span: { start: key.span.start, end: value.span.end },
    };
  }

  // Positional content (no key, just an expression).
  const value = parseExpression(cur, 0);
  return {
    kind: "Attribute",
    key: null,
    value,
    bindTarget: null,
    mode: "static",
    span: value.span,
  };
}

// ─────────────────────────────────────────────────────────────
//  Statement parsers
// ─────────────────────────────────────────────────────────────

function parseIfStmt(cur: TokenCursor): IfStmt {
  const ifTok = cur.next(); // 'if'
  const branches: IfBranch[] = [];
  const cond = parseExpression(cur, 0);
  cur.consume(TokenType.FlowRight, "Expected '->' after if condition.");
  const body = parseArrowBodyAsBlock(cur);
  branches.push({
    kind: "IfBranch",
    condition: cond,
    body,
    span: { start: ifTok.span.start, end: body.span.end },
  });
  while (cur.peek().type === TokenType.Keyword && cur.peek().keyword === "elif") {
    const elifTok = cur.next();
    const c = parseExpression(cur, 0);
    cur.consume(TokenType.FlowRight, "Expected '->' after elif condition.");
    const b = parseArrowBodyAsBlock(cur);
    branches.push({
      kind: "IfBranch",
      condition: c,
      body: b,
      span: { start: elifTok.span.start, end: b.span.end },
    });
  }
  if (cur.peek().type === TokenType.Keyword && cur.peek().keyword === "else") {
    const elseTok = cur.next();
    cur.consume(TokenType.FlowRight, "Expected '->' after 'else'.");
    const b = parseArrowBodyAsBlock(cur);
    branches.push({
      kind: "IfBranch",
      condition: null,
      body: b,
      span: { start: elseTok.span.start, end: b.span.end },
    });
  }
  return {
    kind: "IfStmt",
    branches,
    span: {
      start: ifTok.span.start,
      end: branches[branches.length - 1]!.span.end,
    },
  };
}

function parseWhileStmt(cur: TokenCursor): WhileStmt {
  const start = cur.next(); // 'while'
  const cond = parseExpression(cur, 0);
  cur.consume(TokenType.FlowRight, "Expected '->' after while condition.");
  const body = parseArrowBodyAsBlock(cur);
  return {
    kind: "WhileStmt",
    condition: cond,
    body,
    span: { start: start.span.start, end: body.span.end },
  };
}

function parseForEachStmt(cur: TokenCursor): ForEachStmt {
  const start = cur.next(); // 'forEach'
  // Syntax variants:
  //   forEach X in xs -> ( … )
  //   forEach X in xs as Y -> ( … )
  const item = expectIdentifier(cur, "Expected loop variable in 'forEach'.");
  cur.consume(TokenType.Keyword, "Expected 'in' in 'forEach'.", "in");
  const iterable = parseExpression(cur, 0);
  let binding = item;
  if (cur.peek().type === TokenType.Keyword && cur.peek().keyword === "as") {
    cur.next();
    binding = expectIdentifier(cur, "Expected binding name after 'as'.");
  }
  cur.consume(TokenType.FlowRight, "Expected '->' after 'forEach' header.");
  const body = parseArrowBodyAsBlock(cur);
  return {
    kind: "ForEachStmt",
    iterable,
    binding,
    body,
    span: { start: start.span.start, end: body.span.end },
  };
}

function parseLoopStmt(cur: TokenCursor): LoopStmt {
  const start = cur.next(); // 'loop'
  cur.consume(TokenType.FlowRight, "Expected '->' after 'loop'.");
  const body = parseArrowBodyAsBlock(cur);
  return {
    kind: "LoopStmt",
    body,
    span: { start: start.span.start, end: body.span.end },
  };
}

function parseRepeatStmt(cur: TokenCursor): RepeatStmt {
  const start = cur.next(); // 'repeat'
  const count = parseExpression(cur, 0);
  // Optional `times` keyword.
  if (cur.peek().type === TokenType.Keyword && cur.peek().keyword === "times") {
    cur.next();
  }
  cur.consume(TokenType.FlowRight, "Expected '->' after 'repeat' count.");
  const body = parseArrowBodyAsBlock(cur);
  return {
    kind: "RepeatStmt",
    count,
    body,
    span: { start: start.span.start, end: body.span.end },
  };
}

function parseMatchStmt(cur: TokenCursor): MatchStmt {
  const start = cur.next(); // 'match'
  const scrutinee = parseExpression(cur, 0);
  cur.consume(TokenType.LParen, "Expected '(' after match scrutinee.");
  const cases: MatchCase[] = [];
  while (cur.peek().type !== TokenType.RParen && cur.peek().type !== TokenType.Eof) {
    if (cur.match(TokenType.Comma)) continue;
    const caseTok = cur.peek();
    if (caseTok.type === TokenType.Keyword && caseTok.keyword === "case") {
      cur.next();
      const pattern = parseExpression(cur, 0);
      cur.consume(TokenType.FlowRight, "Expected '->' after 'case' pattern.");
      const body = parseArrowBody(cur);
      cases.push({
        kind: "MatchCase",
        pattern,
        body,
        span: { start: caseTok.span.start, end: body.span.end },
      });
      continue;
    }
    if (caseTok.type === TokenType.Keyword && caseTok.keyword === "otherwise") {
      cur.next();
      cur.consume(TokenType.FlowRight, "Expected '->' after 'otherwise'.");
      const body = parseArrowBody(cur);
      cases.push({
        kind: "MatchCase",
        pattern: null,
        body,
        span: { start: caseTok.span.start, end: body.span.end },
      });
      continue;
    }
    cur.error("MOD-P020", "Expected 'case' or 'otherwise' in match block.", caseTok.span);
    cur.next();
  }
  const close = cur.consume(TokenType.RParen, "Expected ')' to close match block.");
  return {
    kind: "MatchStmt",
    scrutinee,
    cases,
    span: { start: start.span.start, end: close.span.end },
  };
}

function parseAttemptStmt(cur: TokenCursor): AttemptStmt {
  const start = cur.next(); // 'attempt'
  cur.consume(TokenType.FlowRight, "Expected '->' after 'attempt'.");
  const body = parseArrowBodyAsBlock(cur);
  let end = body.span.end;
  let recoverBinding: Identifier | null = null;
  let recoverBody: Block | null = null;
  let ensureBody: Block | null = null;

  if (cur.peek().type === TokenType.Keyword && cur.peek().keyword === "recover") {
    cur.next();
    if (cur.peek().type === TokenType.Identifier) {
      recoverBinding = expectIdentifier(cur, "Expected error binding identifier.");
    }
    cur.consume(TokenType.FlowRight, "Expected '->' after 'recover'.");
    recoverBody = parseArrowBodyAsBlock(cur);
    end = recoverBody.span.end;
  }
  if (cur.peek().type === TokenType.Keyword && cur.peek().keyword === "ensure") {
    cur.next();
    cur.consume(TokenType.FlowRight, "Expected '->' after 'ensure'.");
    ensureBody = parseArrowBodyAsBlock(cur);
    end = ensureBody.span.end;
  }
  return {
    kind: "AttemptStmt",
    body,
    recoverBinding,
    recoverBody,
    ensureBody,
    span: { start: start.span.start, end },
  };
}

function parseBlockOpStmt(
  cur: TokenCursor,
  kw: string,
): TransactionStmt | ParallelStmt | SequenceStmt {
  const start = cur.next();
  cur.consume(TokenType.FlowRight, `Expected '->' after '${kw}'.`);
  const body = parseArrowBodyAsBlock(cur);
  const span: SourceSpan = { start: start.span.start, end: body.span.end };
  if (kw === "transaction") return { kind: "TransactionStmt", body, span };
  if (kw === "parallel") return { kind: "ParallelStmt", body, span };
  return { kind: "SequenceStmt", body, span };
}

function parseJumpStmt(
  cur: TokenCursor,
  kw: string,
): ReturnStmt | ThrowStmt | YieldStmt {
  const start = cur.next();
  // `Return: expr` form requires the colon. Tolerate its absence.
  cur.match(TokenType.Colon);
  let value: Expr | null = null;
  if (!atStatementEnd(cur)) {
    value = parseExpression(cur, 0);
  }
  const end = value ? value.span.end : start.span.end;
  if (kw === "Return") {
    return {
      kind: "ReturnStmt",
      value,
      span: { start: start.span.start, end },
    };
  }
  if (kw === "Yield") {
    return {
      kind: "YieldStmt",
      value,
      span: { start: start.span.start, end },
    };
  }
  if (!value) {
    cur.error("MOD-P021", "'Throw' requires a value.", start.span);
    value = {
      kind: "ErrorExpr",
      message: "missing throw value",
      span: start.span,
    };
  }
  return {
    kind: "ThrowStmt",
    value,
    span: { start: start.span.start, end },
  };
}

function parseBreakStmt(cur: TokenCursor): BreakStmt {
  const tok = cur.next();
  return { kind: "BreakStmt", span: tok.span };
}

function parseContinueStmt(cur: TokenCursor): ContinueStmt {
  const tok = cur.next();
  return { kind: "ContinueStmt", span: tok.span };
}

function parseCheckStmt(
  cur: TokenCursor,
  kw: string,
): RequireStmt | AssertStmt | ExpectStmt {
  const start = cur.next();
  const condition = parseExpression(cur, 0);
  const span: SourceSpan = { start: start.span.start, end: condition.span.end };
  if (kw === "require") return { kind: "RequireStmt", condition, span };
  if (kw === "assert") return { kind: "AssertStmt", condition, span };
  return { kind: "ExpectStmt", condition, span };
}

function parseOnStmt(cur: TokenCursor): EventWireStmt {
  const start = cur.next(); // 'On'
  const event = parseExpression(cur, 0);
  cur.consume(TokenType.FlowRight, "Expected '->' after 'On' event.");
  const handler = parseArrowBody(cur);
  return {
    kind: "EventWireStmt",
    event,
    handler,
    span: { start: start.span.start, end: handler.span.end },
  };
}

function parseBindStmt(cur: TokenCursor): BindStmt {
  const element = expectIdentifier(cur, "Expected element identifier.");
  cur.next(); // '::'
  const target = expectIdentifier(cur, "Expected state identifier after '::'.");
  let attrs: AttrList | null = null;
  let end = target.span.end;
  // Trailing attribute pairs on the same logical line.
  if (peekHasTrailingAttrs(cur)) {
    attrs = collectInlineAttrs(cur);
    end = attrs.span.end;
  }
  return {
    kind: "BindStmt",
    element,
    target,
    attrs,
    span: { start: element.span.start, end },
  };
}

function parseReactiveAssign(cur: TokenCursor): ReactiveAssignStmt {
  const targetTok = cur.next();
  const target: Identifier = {
    kind: "Identifier",
    name: targetTok.lexeme,
    span: targetTok.span,
  };
  cur.next(); // '<-'
  const value = parseExpression(cur, 0);
  return {
    kind: "ReactiveAssignStmt",
    target,
    value,
    span: { start: target.span.start, end: value.span.end },
  };
}

function parseSyncStmt(cur: TokenCursor): SyncStmt {
  const leftTok = cur.next();
  const left: Identifier = {
    kind: "Identifier",
    name: leftTok.lexeme,
    span: leftTok.span,
  };
  cur.next(); // '<->'
  const right = parseExpression(cur, 0);
  return {
    kind: "SyncStmt",
    left,
    right,
    span: { start: left.span.start, end: right.span.end },
  };
}

function parseEventWireStmt(cur: TokenCursor): EventWireStmt {
  const eventTok = cur.next();
  const event: Identifier = {
    kind: "Identifier",
    name: eventTok.lexeme,
    span: eventTok.span,
  };
  cur.next(); // '->'
  const handler = parseArrowBody(cur);
  return {
    kind: "EventWireStmt",
    event,
    handler,
    span: { start: event.span.start, end: handler.span.end },
  };
}

function parseExpressionOrEffectStmt(cur: TokenCursor): Stmt {
  const startTok = cur.peek();
  if (startTok.type === TokenType.Eof) {
    return makeErrorStmt(cur, "Unexpected end of input.", startTok.span);
  }
  const expr = parseExpression(cur, 0);
  if (cur.peek().type === TokenType.ApplyEffect) {
    cur.next();
    const effect = parseExpression(cur, 0);
    const applied: ApplyEffectStmt = {
      kind: "ApplyEffectStmt",
      target: expr,
      effect,
      span: { start: expr.span.start, end: effect.span.end },
    };
    return applied;
  }
  const stmt: ExpressionStmt = {
    kind: "ExpressionStmt",
    expression: expr,
    span: expr.span,
  };
  return stmt;
}

function makeErrorStmt(
  cur: TokenCursor,
  message: string,
  span: SourceSpan,
): ErrorStmt {
  cur.error("MOD-P001", message, span);
  synchronize(cur);
  return { kind: "ErrorStmt", message, span };
}

// ─────────────────────────────────────────────────────────────
//  Misc helpers
// ─────────────────────────────────────────────────────────────

/** True if the cursor sits at a token that terminates a statement. */
function atStatementEnd(cur: TokenCursor): boolean {
  if (cur.atNewline()) return true;
  const t = cur.peek();
  return (
    t.type === TokenType.Eof ||
    t.type === TokenType.RParen ||
    t.type === TokenType.RBrace ||
    t.type === TokenType.RBracket ||
    t.type === TokenType.Comma
  );
}

/** True if there appear to be more attribute pairs on this logical line. */
function peekHasTrailingAttrs(cur: TokenCursor): boolean {
  if (cur.atNewline() || atStatementEnd(cur)) return false;
  return true;
}

/**
 * Collect a sequence of inline attributes that follow a statement
 * header on the same line (e.g. `placeholder: "x"  Click -> Y`).
 * Stops at newline / `)` / `,` / EOF.
 */
function collectInlineAttrs(cur: TokenCursor): AttrList {
  const startSpan = cur.peek().span;
  const entries: Attribute[] = [];
  while (!cur.atNewline() && !atStatementEnd(cur)) {
    const before = cur.peek();
    const a = parseAttribute(cur);
    if (a) entries.push(a);
    if (cur.peek() === before) cur.next();
  }
  const endSpan = entries.length > 0 ? entries[entries.length - 1]!.span : startSpan;
  return {
    kind: "AttrList",
    entries,
    span: { start: startSpan.start, end: endSpan.end },
  };
}

/**
 * Variant of `parseArrowBody` that ALWAYS returns a Block, wrapping a
 * single expression in a Block with one ExpressionStmt item when
 * needed. Used by statements that semantically require a block body
 * (if, while, attempt, …).
 */
function parseArrowBodyAsBlock(cur: TokenCursor): Block {
  const body = parseArrowBody(cur);
  if (body.kind === "Block") return body;
  const item: ExpressionStmt = {
    kind: "ExpressionStmt",
    expression: body,
    span: body.span,
  };
  return {
    kind: "Block",
    items: [item],
    span: body.span,
  };
}

// ─────────────────────────────────────────────────────────────
//  Re-exports needed by other modules
// ─────────────────────────────────────────────────────────────

export type { Token, TypeRef };
