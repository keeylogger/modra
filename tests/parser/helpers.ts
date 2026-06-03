/**
 * Shared helpers for parser tests.
 */

import { expect } from "vitest";
import {
  Parser,
  parseExpression,
  TokenCursor,
  Scanner,
  TokenType,
  DiagnosticCollector,
  type AnyNode,
  type BlockItem,
  type Expr,
  type FileNode,
  type TopLevelDecl,
} from "../../src/index.js";

export function parse(src: string): { ast: FileNode; diagnostics: readonly unknown[] } {
  return new Parser(src, "<test>").parseFile();
}

export function parseOk(src: string): FileNode {
  const { ast, diagnostics } = parse(src);
  const errors = diagnostics.filter(
    (d): d is { severity: string; message: string } =>
      typeof d === "object" && d !== null && (d as { severity?: string }).severity === "error",
  );
  expect(errors, errors.map((e) => e.message).join("\n")).toHaveLength(0);
  return ast;
}

export function expr(src: string): Expr {
  // Build an expression directly with a cursor over the source.
  const tokens = new Scanner(src)
    .scanAll({ keepTrivia: true })
    .filter(
      (t) =>
        t.type !== TokenType.Whitespace &&
        t.type !== TokenType.CommentLine &&
        t.type !== TokenType.CommentBlock &&
        t.type !== TokenType.Newline,
    );
  const diag = new DiagnosticCollector();
  const cur = new TokenCursor(tokens, "<expr>", diag);
  return parseExpression(cur, 0);
}

export function firstDecl(src: string): TopLevelDecl {
  const ast = parseOk(src);
  expect(ast.declarations.length).toBeGreaterThan(0);
  return ast.declarations[0]!;
}

export function firstBlockItem(src: string): BlockItem {
  // Wrap the source in a tiny block holder so we always have a parse target.
  const ast = parseOk(src);
  expect(ast.declarations.length).toBeGreaterThan(0);
  const decl = ast.declarations[0]!;
  if (decl.kind === "ComponentDecl" || decl.kind === "ActionDecl" || decl.kind === "EndpointDecl") {
    expect(decl.body.items.length).toBeGreaterThan(0);
    return decl.body.items[0]!;
  }
  return decl;
}

export function kinds(items: AnyNode[]): string[] {
  return items.map((i) => i.kind);
}
