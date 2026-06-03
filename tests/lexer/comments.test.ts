import { describe, it, expect } from "vitest";
import { Scanner, TokenType } from "../../src/index.js";

describe("comments", () => {
  it("filters line comments out by default", () => {
    const toks = new Scanner("a // a hint\nb").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.Identifier,
      TokenType.Identifier,
      TokenType.Eof,
    ]);
  });

  it("preserves line comments when keepTrivia is true", () => {
    const toks = new Scanner("a // hint\nb").scanAll({ keepTrivia: true });
    const kinds = toks.map((t) => t.type);
    expect(kinds).toContain(TokenType.CommentLine);
  });

  it("filters block comments out by default", () => {
    const toks = new Scanner("a /* one\ntwo */ b").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.Identifier,
      TokenType.Identifier,
      TokenType.Eof,
    ]);
  });

  it("preserves block comments when keepTrivia is true", () => {
    const toks = new Scanner("a /* one */ b").scanAll({ keepTrivia: true });
    expect(toks.some((t) => t.type === TokenType.CommentBlock)).toBe(true);
  });

  it("emits a diagnostic for an unterminated block comment", () => {
    const scanner = new Scanner("/* never closed");
    scanner.scanAll();
    expect(scanner.diagnostics.some((d) => d.code === "MOD-L009")).toBe(true);
  });

  it("line comment ends at newline, not at next //", () => {
    const toks = new Scanner("// first comment\n// second\nx").scanAll({ keepTrivia: true });
    const comments = toks.filter((t) => t.type === TokenType.CommentLine);
    expect(comments).toHaveLength(2);
    expect(comments[0]!.value).toBe(" first comment");
    expect(comments[1]!.value).toBe(" second");
  });

  it("block comment carries content (without delimiters) as value", () => {
    const tok = new Scanner("/* hello */ ").scanAll({ keepTrivia: true })[0]!;
    expect(tok.type).toBe(TokenType.CommentBlock);
    expect(tok.value).toBe(" hello ");
  });

  it("does not treat '//' inside a string as a comment", () => {
    const tok = new Scanner('"https://example.com"').scanAll()[0]!;
    expect(tok.type).toBe(TokenType.StringLiteral);
    expect(tok.value).toBe("https://example.com");
  });
});
