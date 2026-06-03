/**
 * Top-level declaration parsing.
 *
 * `parseFile(cur)` is the parser entry point — produces a FileNode.
 *
 * Top-level declarations are recognised by their leading keyword
 * (`Style`, `Component`, `Endpoint`, `Action`, `Database`, `Type`).
 * Anything else at file scope is treated as an ElementDecl (variable /
 * inline element), matching the behaviour inside block bodies.
 */

import type {
  ActionDecl,
  ColumnDecl,
  ComponentDecl,
  DatabaseDecl,
  Decorator,
  Directive,
  DottedName,
  ElementDecl,
  EndpointDecl,
  ErrorDecl,
  Expr,
  FileNode,
  Identifier,
  Parameter,
  StyleDecl,
  TableDecl,
  TopLevelDecl,
  TypeDecl,
  TypeRef,
  UsingDecl,
} from "../ast/nodes.js";
import { TokenType, type Token } from "../lexer/tokens.js";
import type { SourceSpan } from "../utils/source.js";
import type { TokenCursor } from "./parser.js";
import { expectIdentifier, parseExpression } from "./pratt.js";
import {
  isGenericLabelAhead,
  parseBlock,
  parseDecorator,
  parseDirective,
  parseElementDecl,
  registerNestedDeclParser,
} from "./statements.js";
import { synchronize } from "./recovery.js";

// ─────────────────────────────────────────────────────────────
//  Entry point
// ─────────────────────────────────────────────────────────────

export function parseFile(cur: TokenCursor): FileNode {
  const fileDirectives: Directive[] = [];
  const usings: UsingDecl[] = [];
  const declarations: TopLevelDecl[] = [];
  const fileStart = cur.peek().span;
  let fileEnd: SourceSpan = fileStart;

  // 1. File-top directives (loose @@x sequence before any decl).
  while (cur.peek().type === TokenType.DirectiveAt) {
    fileDirectives.push(parseDirective(cur));
  }

  // 2. Usings.
  while (
    cur.peek().type === TokenType.Keyword &&
    cur.peek().keyword === "using"
  ) {
    usings.push(parseUsingDecl(cur));
  }

  // 3. Declarations.
  while (!cur.isAtEnd()) {
    const before = cur.peek();
    const decl = parseTopLevelDecl(cur);
    if (decl) {
      declarations.push(decl);
      fileEnd = decl.span;
    }
    if (cur.peek() === before) {
      cur.error(
        "MOD-P001",
        `Unexpected token '${cur.peek().lexeme}' at file scope.`,
        cur.peek().span,
      );
      cur.next();
      synchronize(cur);
    }
  }

  return {
    kind: "File",
    directives: fileDirectives,
    usings,
    declarations,
    span: { start: fileStart.start, end: fileEnd.end },
  };
}

// ─────────────────────────────────────────────────────────────
//  Using
// ─────────────────────────────────────────────────────────────

export function parseUsingDecl(cur: TokenCursor): UsingDecl {
  const start = cur.next(); // 'using' keyword
  const path = parseDottedName(cur);
  let alias: Identifier | null = null;
  let end = path.span.end;
  if (cur.peek().type === TokenType.Keyword && cur.peek().keyword === "as") {
    cur.next();
    alias = expectIdentifier(cur, "Expected alias name after 'as'.");
    end = alias.span.end;
  }
  return {
    kind: "UsingDecl",
    path,
    alias,
    span: { start: start.span.start, end },
  };
}

function parseDottedName(cur: TokenCursor): DottedName {
  const parts: Identifier[] = [];
  parts.push(expectIdentifier(cur, "Expected module identifier."));
  while (cur.peek().type === TokenType.Dot) {
    cur.next();
    parts.push(expectIdentifier(cur, "Expected identifier after '.'."));
  }
  const span: SourceSpan = {
    start: parts[0]!.span.start,
    end: parts[parts.length - 1]!.span.end,
  };
  return { kind: "DottedName", parts, span };
}

// ─────────────────────────────────────────────────────────────
//  Top-level dispatch
// ─────────────────────────────────────────────────────────────

export function parseTopLevelDecl(cur: TokenCursor): TopLevelDecl | null {
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

  return parseTopLevelDeclWithAnnotations(cur, directives, decorators);
}

/**
 * Parse a top-level declaration assuming leading annotations have
 * already been collected. Used both at file scope and (via the
 * registered nested hook) from inside block bodies.
 */
function parseTopLevelDeclWithAnnotations(
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
): TopLevelDecl | null {
  const tok = cur.peek();
  if (tok.type === TokenType.Eof) {
    if (directives.length > 0 || decorators.length > 0) {
      return orphanAnnotationDecl(directives, decorators, tok.span);
    }
    return null;
  }

  if (tok.type === TokenType.Keyword) {
    const kw = tok.keyword!;
    switch (kw) {
      case "Style":
        return parseStyleDecl(cur, directives, decorators);
      case "Component":
        return parseComponentDecl(cur, directives, decorators);
      case "Endpoint":
        return parseEndpointDecl(cur, directives, decorators);
      case "Action":
        return parseActionDecl(cur, directives, decorators);
      case "Database":
        return parseDatabaseDecl(cur, directives, decorators);
      case "Type":
        return parseTypeDecl(cur, directives, decorators);
      // Top-level usings are handled separately; if we hit one here
      // it's a misordered import — accept and parse as decl-less node.
      case "using":
        cur.error(
          "MOD-P030",
          "'using' declarations must appear before any other declaration.",
          tok.span,
        );
        const u = parseUsingDecl(cur);
        return makeErrorDeclFromUsing(u);
      default:
        break;
    }
  }

  // Identifier-led declaration at file scope (e.g. `Number: X <- 0`).
  if (tok.type === TokenType.Identifier) {
    const next = cur.peek(1);
    if (next.type === TokenType.Colon) {
      return parseElementDecl(cur, directives, decorators);
    }
    // Generic-typed label: `Array<Object>: …`.
    if (next.type === TokenType.LessThan && isGenericLabelAhead(cur)) {
      return parseElementDecl(cur, directives, decorators);
    }
  }

  // Unknown — record and skip.
  cur.error(
    "MOD-P001",
    `Unexpected token '${tok.lexeme}' at top level.`,
    tok.span,
  );
  cur.next();
  synchronize(cur);
  return null;
}

function makeErrorDeclFromUsing(u: UsingDecl): ErrorDecl {
  return {
    kind: "ErrorDecl",
    message: "Misordered 'using' declaration.",
    span: u.span,
  };
}

function orphanAnnotationDecl(
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
//  Style
// ─────────────────────────────────────────────────────────────

function parseStyleDecl(
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
): StyleDecl {
  const start = cur.next(); // 'Style'
  cur.consume(TokenType.Colon, "Expected ':' after 'Style'.");
  const name = expectIdentifier(cur, "Expected style name.");
  let base: Identifier | null = null;
  if (cur.peek().type === TokenType.Keyword && cur.peek().keyword === "from") {
    cur.next();
    base = expectIdentifier(cur, "Expected base style name after 'from'.");
  }
  // Body is an attribute-block of property ElementDecls.
  const block = parseBlock(cur);
  const body: ElementDecl[] = [];
  for (const item of block.items) {
    if (item.kind === "ElementDecl") {
      body.push(item);
    } else {
      cur.error(
        "MOD-P031",
        "Style bodies may only contain property declarations.",
        item.span,
      );
    }
  }
  return {
    kind: "StyleDecl",
    name,
    base,
    body,
    decorators,
    directives,
    span: { start: start.span.start, end: block.span.end },
  };
}

// ─────────────────────────────────────────────────────────────
//  Component
// ─────────────────────────────────────────────────────────────

function parseComponentDecl(
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
): ComponentDecl {
  const start = cur.next(); // 'Component'
  cur.consume(TokenType.Colon, "Expected ':' after 'Component'.");
  const name = expectIdentifier(cur, "Expected component name.");
  const params: Parameter[] = cur.peek().type === TokenType.LParen ? parseParameters(cur) : [];

  const composes: Identifier[] = [];
  let wraps: Identifier | null = null;
  let init: Identifier | null = null;
  const emits: Identifier[] = [];
  const consumes: Identifier[] = [];

  while (true) {
    const p = cur.peek();
    if (p.type !== TokenType.Keyword) break;
    if (p.keyword === "composes") {
      cur.next();
      composes.push(expectIdentifier(cur, "Expected identifier after 'composes'."));
      while (cur.match(TokenType.Comma)) {
        composes.push(expectIdentifier(cur, "Expected identifier in 'composes' list."));
      }
      continue;
    }
    if (p.keyword === "wraps") {
      cur.next();
      wraps = expectIdentifier(cur, "Expected identifier after 'wraps'.");
      continue;
    }
    if (p.keyword === "init") {
      cur.next();
      init = expectIdentifier(cur, "Expected identifier after 'init'.");
      continue;
    }
    if (p.keyword === "emits") {
      cur.next();
      emits.push(expectIdentifier(cur, "Expected identifier after 'emits'."));
      while (cur.match(TokenType.Comma)) {
        emits.push(expectIdentifier(cur, "Expected identifier in 'emits' list."));
      }
      continue;
    }
    if (p.keyword === "consumes") {
      cur.next();
      consumes.push(expectIdentifier(cur, "Expected identifier after 'consumes'."));
      while (cur.match(TokenType.Comma)) {
        consumes.push(expectIdentifier(cur, "Expected identifier in 'consumes' list."));
      }
      continue;
    }
    break;
  }

  cur.consume(TokenType.FlowRight, "Expected '->' before Component body.");
  const body = parseBlock(cur);
  return {
    kind: "ComponentDecl",
    name,
    params,
    composes,
    wraps,
    init,
    emits,
    consumes,
    body,
    decorators,
    directives,
    span: { start: start.span.start, end: body.span.end },
  };
}

// ─────────────────────────────────────────────────────────────
//  Endpoint
// ─────────────────────────────────────────────────────────────

function parseEndpointDecl(
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
): EndpointDecl {
  const start = cur.next(); // 'Endpoint'
  cur.consume(TokenType.Colon, "Expected ':' after 'Endpoint'.");
  const name = expectIdentifier(cur, "Expected endpoint name.");
  const params = cur.peek().type === TokenType.LParen ? parseParameters(cur) : [];
  // Optional return type: `Endpoint: X(): ReturnType -> ( … )`.
  let returnType: TypeRef | null = null;
  if (cur.peek().type === TokenType.Colon) {
    cur.next();
    returnType = parseTypeRef(cur);
  }
  cur.consume(TokenType.FlowRight, "Expected '->' before Endpoint body.");
  const body = parseBlock(cur);
  return {
    kind: "EndpointDecl",
    name,
    params,
    returnType,
    body,
    decorators,
    directives,
    span: { start: start.span.start, end: body.span.end },
  };
}

// ─────────────────────────────────────────────────────────────
//  Action
// ─────────────────────────────────────────────────────────────

function parseActionDecl(
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
): ActionDecl {
  const start = cur.next(); // 'Action'
  cur.consume(TokenType.Colon, "Expected ':' after 'Action'.");
  const name = expectIdentifier(cur, "Expected action name.");
  const params: Parameter[] =
    cur.peek().type === TokenType.LParen ? parseParameters(cur) : [];

  const emits: Identifier[] = [];
  const consumes: Identifier[] = [];
  while (true) {
    const p = cur.peek();
    if (p.type !== TokenType.Keyword) break;
    if (p.keyword === "emits") {
      cur.next();
      emits.push(expectIdentifier(cur, "Expected identifier after 'emits'."));
      while (cur.match(TokenType.Comma)) {
        emits.push(expectIdentifier(cur, "Expected identifier in 'emits' list."));
      }
      continue;
    }
    if (p.keyword === "consumes") {
      cur.next();
      consumes.push(expectIdentifier(cur, "Expected identifier after 'consumes'."));
      while (cur.match(TokenType.Comma)) {
        consumes.push(expectIdentifier(cur, "Expected identifier in 'consumes' list."));
      }
      continue;
    }
    break;
  }

  cur.consume(TokenType.FlowRight, "Expected '->' before Action body.");
  const body = parseBlock(cur);
  return {
    kind: "ActionDecl",
    name,
    params,
    emits,
    consumes,
    body,
    decorators,
    directives,
    span: { start: start.span.start, end: body.span.end },
  };
}

// ─────────────────────────────────────────────────────────────
//  Database / Table / Column
// ─────────────────────────────────────────────────────────────

function parseDatabaseDecl(
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
): DatabaseDecl {
  const start = cur.next(); // 'Database'
  cur.consume(TokenType.Colon, "Expected ':' after 'Database'.");
  const backend = expectIdentifier(cur, "Expected database backend (e.g. Postgres).");
  cur.consume(TokenType.FlowRight, "Expected '->' before Database body.");
  cur.consume(TokenType.LParen, "Expected '(' to open Database body.");
  const tables: TableDecl[] = [];
  while (cur.peek().type !== TokenType.RParen && cur.peek().type !== TokenType.Eof) {
    if (cur.match(TokenType.Comma)) continue;
    const before = cur.peek();
    const table = parseTableDecl(cur);
    if (table) tables.push(table);
    if (cur.peek() === before) cur.next();
  }
  const close = cur.consume(TokenType.RParen, "Expected ')' to close Database body.");
  return {
    kind: "DatabaseDecl",
    backend,
    tables,
    decorators,
    directives,
    span: { start: start.span.start, end: close.span.end },
  };
}

function parseTableDecl(cur: TokenCursor): TableDecl | null {
  // Allow leading decorators on a table.
  const decorators: Decorator[] = [];
  while (cur.peek().type === TokenType.Decorator) {
    decorators.push(parseDecorator(cur));
  }
  if (!(cur.peek().type === TokenType.Keyword && cur.peek().keyword === "Table")) {
    cur.error(
      "MOD-P032",
      `Expected 'Table' inside Database body, got '${cur.peek().lexeme}'.`,
      cur.peek().span,
    );
    cur.next();
    return null;
  }
  const start = cur.next(); // 'Table'
  cur.consume(TokenType.Colon, "Expected ':' after 'Table'.");
  const name = expectIdentifier(cur, "Expected table name.");
  cur.consume(TokenType.FlowRight, "Expected '->' before Table body.");
  cur.consume(TokenType.LParen, "Expected '(' to open Table body.");
  const columns: ColumnDecl[] = [];
  while (cur.peek().type !== TokenType.RParen && cur.peek().type !== TokenType.Eof) {
    if (cur.match(TokenType.Comma)) continue;
    const before = cur.peek();
    const col = parseColumnDecl(cur);
    if (col) columns.push(col);
    if (cur.peek() === before) cur.next();
  }
  const close = cur.consume(TokenType.RParen, "Expected ')' to close Table body.");
  return {
    kind: "TableDecl",
    name,
    columns,
    decorators,
    span: { start: start.span.start, end: close.span.end },
  };
}

function parseColumnDecl(cur: TokenCursor): ColumnDecl | null {
  const decorators: Decorator[] = [];
  while (cur.peek().type === TokenType.Decorator) {
    decorators.push(parseDecorator(cur));
  }
  if (cur.peek().type !== TokenType.Identifier) {
    cur.error(
      "MOD-P033",
      `Expected column type identifier in Table body, got '${cur.peek().lexeme}'.`,
      cur.peek().span,
    );
    cur.next();
    return null;
  }
  const type = parseTypeRef(cur);
  cur.consume(TokenType.Colon, "Expected ':' after column type.");
  const name = expectIdentifier(cur, "Expected column name.");
  let init: Expr | null = null;
  let end = name.span.end;
  if (cur.peek().type === TokenType.AssignLeft) {
    cur.next();
    init = parseExpression(cur, 0);
    end = init.span.end;
  }
  // Trailing column decorators.
  while (cur.peek().type === TokenType.Decorator) {
    decorators.push(parseDecorator(cur));
    end = cur.previous().span.end;
  }
  return {
    kind: "ColumnDecl",
    type,
    name,
    init,
    decorators,
    span: { start: type.span.start, end },
  };
}

// ─────────────────────────────────────────────────────────────
//  Type
// ─────────────────────────────────────────────────────────────

function parseTypeDecl(
  cur: TokenCursor,
  directives: Directive[],
  decorators: Decorator[],
): TypeDecl {
  const start = cur.next(); // 'Type'
  cur.consume(TokenType.Colon, "Expected ':' after 'Type'.");
  const name = expectIdentifier(cur, "Expected type name.");
  cur.consume(TokenType.Colon, "Expected ':' between type name and alias.");
  const alias = parseTypeRef(cur);
  let end = alias.span.end;
  // Trailing decorators (`@Format(email)` etc.).
  while (cur.peek().type === TokenType.Decorator) {
    decorators.push(parseDecorator(cur));
    end = cur.previous().span.end;
  }
  return {
    kind: "TypeDecl",
    name,
    alias,
    decorators,
    directives,
    span: { start: start.span.start, end },
  };
}

// ─────────────────────────────────────────────────────────────
//  Parameters & types
// ─────────────────────────────────────────────────────────────

export function parseParameters(cur: TokenCursor): Parameter[] {
  cur.consume(TokenType.LParen, "Expected '(' to open parameter list.");
  const params: Parameter[] = [];
  while (cur.peek().type !== TokenType.RParen && cur.peek().type !== TokenType.Eof) {
    if (cur.match(TokenType.Comma)) continue;
    const before = cur.peek();
    const p = parseParameter(cur);
    if (p) params.push(p);
    if (cur.peek() === before) cur.next();
  }
  cur.consume(TokenType.RParen, "Expected ')' to close parameter list.");
  return params;
}

function parseParameter(cur: TokenCursor): Parameter | null {
  const name = expectIdentifier(cur, "Expected parameter name.");
  let type: TypeRef | null = null;
  let defaultValue: Expr | null = null;
  let end = name.span.end;
  if (cur.peek().type === TokenType.Colon) {
    cur.next();
    type = parseTypeRef(cur);
    end = type.span.end;
  }
  if (cur.peek().type === TokenType.Equals) {
    cur.next();
    defaultValue = parseExpression(cur, 0);
    end = defaultValue.span.end;
  }
  return {
    kind: "Parameter",
    name,
    type,
    defaultValue,
    span: { start: name.span.start, end },
  };
}

export function parseTypeRef(cur: TokenCursor): TypeRef {
  const name = expectIdentifier(cur, "Expected type name.");
  const generics: TypeRef[] = [];
  let end = name.span.end;
  if (cur.peek().type === TokenType.LessThan) {
    cur.next();
    while (cur.peek().type !== TokenType.GreaterThan && cur.peek().type !== TokenType.Eof) {
      if (cur.match(TokenType.Comma)) continue;
      generics.push(parseTypeRef(cur));
    }
    const gt = cur.consume(TokenType.GreaterThan, "Expected '>' to close generic parameters.");
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

// ─────────────────────────────────────────────────────────────
//  Register the nested-decl hook (module side-effect: installs the
//  delegate used by parseBlockItem to parse nested Style/Component/…
//  declarations without a hard import cycle).
// ─────────────────────────────────────────────────────────────

registerNestedDeclParser((cur, directives, decorators) =>
  parseTopLevelDeclWithAnnotations(cur, directives, decorators),
);

// ─────────────────────────────────────────────────────────────
//  Re-exports
// ─────────────────────────────────────────────────────────────

export type { Token };
