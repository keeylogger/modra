import { describe, it, expect } from "vitest";
import { Scanner, TokenType } from "../../src/index.js";

describe("injection mode (@{ … })", () => {
  it("opens with @{ and closes with }", () => {
    const toks = new Scanner("@{x}").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.InjectStart,
      TokenType.Identifier,
      TokenType.InjectEnd,
      TokenType.Eof,
    ]);
  });

  it("scans Modra tokens inside the injection", () => {
    const toks = new Scanner("@{a + 1}").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.InjectStart,
      TokenType.Identifier,
      TokenType.Plus,
      TokenType.NumberLiteral,
      TokenType.InjectEnd,
      TokenType.Eof,
    ]);
  });

  it("tracks nested braces inside an injection", () => {
    const toks = new Scanner("@{{a}}").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.InjectStart,
      TokenType.LBrace,
      TokenType.Identifier,
      TokenType.RBrace,
      TokenType.InjectEnd,
      TokenType.Eof,
    ]);
  });

  it("handles deeply nested braces", () => {
    const toks = new Scanner("@{ {{x}} }").scanAll();
    expect(toks[0]!.type).toBe(TokenType.InjectStart);
    expect(toks[toks.length - 2]!.type).toBe(TokenType.InjectEnd);
  });

  it("supports a string inside an injection", () => {
    const toks = new Scanner('@{f("hi")}').scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.InjectStart,
      TokenType.Identifier,
      TokenType.LParen,
      TokenType.StringLiteral,
      TokenType.RParen,
      TokenType.InjectEnd,
      TokenType.Eof,
    ]);
  });

  it("supports an injection inside a string", () => {
    const toks = new Scanner('"hi {name}!"').scanAll();
    const kinds = toks.map((t) => t.type);
    // Interpolated strings emit StringChunk pieces (no StringLiteral);
    // the simple-string convenience emission only fires when there are
    // zero injections.
    expect(kinds).toContain(TokenType.StringChunk);
    expect(kinds).toContain(TokenType.InjectStart);
    expect(kinds).toContain(TokenType.InjectEnd);
    expect(kinds).not.toContain(TokenType.StringLiteral);
    expect(kinds.filter((k) => k === TokenType.StringChunk).length).toBe(2);
  });

  it("nested injections inside strings inside injections round-trip", () => {
    const toks = new Scanner('@{ "wrap-{inner}-tail" }').scanAll();
    const kinds = toks.map((t) => t.type);
    expect(kinds[0]).toBe(TokenType.InjectStart);
    expect(kinds[kinds.length - 2]).toBe(TokenType.InjectEnd);
    expect(kinds).toContain(TokenType.StringChunk);
    expect(kinds.filter((k) => k === TokenType.InjectStart).length).toBe(2);
    expect(kinds.filter((k) => k === TokenType.InjectEnd).length).toBe(2);
    expect(kinds.filter((k) => k === TokenType.StringChunk).length).toBe(2);
  });

  it("injection at the very start of a string emits an empty leading chunk", () => {
    // Sequence anchors positions for tooling: empty StringChunk, then injection,
    // then trailing StringChunk.
    const toks = new Scanner('"{x}!"').scanAll();
    expect(toks[0]!.type).toBe(TokenType.StringChunk);
    expect(toks[0]!.value).toBe("");
    expect(toks[1]!.type).toBe(TokenType.InjectStart);
    expect(toks[2]!.type).toBe(TokenType.Identifier);
    expect(toks[3]!.type).toBe(TokenType.InjectEnd);
    expect(toks[4]!.type).toBe(TokenType.StringChunk);
    expect(toks[4]!.value).toBe("!");
  });

  it("preserves InjectStart / InjectEnd lexemes", () => {
    const toks = new Scanner("@{x}").scanAll();
    expect(toks[0]!.lexeme).toBe("@{");
    expect(toks[2]!.lexeme).toBe("}");
  });
});
