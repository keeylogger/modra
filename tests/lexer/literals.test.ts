import { describe, it, expect } from "vitest";
import { Scanner, TokenType } from "../../src/index.js";

describe("literals", () => {
  it("recognises integer numbers", () => {
    const toks = new Scanner("0 42 1000").scanAll();
    expect(toks.slice(0, 3).map((t) => t.type)).toEqual([
      TokenType.NumberLiteral,
      TokenType.NumberLiteral,
      TokenType.NumberLiteral,
    ]);
    expect(toks.slice(0, 3).map((t) => t.value)).toEqual([0, 42, 1000]);
  });

  it("recognises decimal numbers", () => {
    const toks = new Scanner("3.14 0.95 100.5").scanAll();
    expect(toks.slice(0, 3).map((t) => t.value)).toEqual([3.14, 0.95, 100.5]);
  });

  it("does NOT consume the dot when it isn't followed by a digit (member access)", () => {
    const toks = new Scanner("42.name").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.NumberLiteral,
      TokenType.Dot,
      TokenType.Identifier,
      TokenType.Eof,
    ]);
    expect(toks[0]!.value).toBe(42);
  });

  it("recognises 3/6/8-digit hex colours", () => {
    for (const c of ["#fff", "#1D1D1F", "#00000080"]) {
      const tok = new Scanner(c).scanAll()[0]!;
      expect(tok.type).toBe(TokenType.HexColor);
      expect(tok.value).toBe(c);
    }
  });

  it("emits a diagnostic for malformed hex colour", () => {
    const scanner = new Scanner("#12");
    scanner.scanAll();
    expect(scanner.diagnostics.some((d) => d.code === "MOD-L004")).toBe(true);
  });

  it("scans simple string literals", () => {
    const tok = new Scanner('"hello world"').scanAll()[0]!;
    expect(tok.type).toBe(TokenType.StringLiteral);
    expect(tok.value).toBe("hello world");
    expect(tok.lexeme).toBe('"hello world"');
  });

  it("scans empty string literals", () => {
    const tok = new Scanner('""').scanAll()[0]!;
    expect(tok.type).toBe(TokenType.StringLiteral);
    expect(tok.value).toBe("");
  });

  it("decodes common escape sequences", () => {
    const tok = new Scanner('"line\\nnext\\ttab\\"quote"').scanAll()[0]!;
    expect(tok.type).toBe(TokenType.StringLiteral);
    expect(tok.value).toBe('line\nnext\ttab"quote');
  });

  it("scans triple-quoted multi-line strings", () => {
    const src = '"""hello\nworld"""';
    const tok = new Scanner(src).scanAll()[0]!;
    expect(tok.type).toBe(TokenType.StringLiteral);
    expect(tok.value).toBe("hello\nworld");
  });

  it("emits a diagnostic for unterminated single-line string", () => {
    const scanner = new Scanner('"never closed');
    scanner.scanAll();
    expect(scanner.diagnostics.some((d) => d.code === "MOD-L007")).toBe(true);
  });

  it("emits a diagnostic for unterminated triple-quoted string", () => {
    const scanner = new Scanner('"""never closed');
    scanner.scanAll();
    expect(scanner.diagnostics.some((d) => d.code === "MOD-L005")).toBe(true);
  });

  it("emits a diagnostic on newline inside single-quoted string", () => {
    const scanner = new Scanner('"oops\nbroken"');
    scanner.scanAll();
    expect(scanner.diagnostics.some((d) => d.code === "MOD-L007")).toBe(true);
  });
});
