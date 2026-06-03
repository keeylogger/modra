import { describe, it, expect } from "vitest";
import { Scanner, TokenType } from "../../src/index.js";

function types(src: string): TokenType[] {
  return new Scanner(src).scanAll().map((t) => t.type);
}

describe("operators — Modra arrows", () => {
  it("disambiguates <- vs <= vs <-> vs <: vs <", () => {
    expect(types("<- <= <-> <: <")).toEqual([
      TokenType.AssignLeft,
      TokenType.LessEqual,
      TokenType.SyncBoth,
      TokenType.ApplyEffect,
      TokenType.LessThan,
      TokenType.Eof,
    ]);
  });

  it("disambiguates -> vs -", () => {
    expect(types("-> -")).toEqual([TokenType.FlowRight, TokenType.Minus, TokenType.Eof]);
  });

  it("disambiguates >= vs >", () => {
    expect(types(">= >")).toEqual([TokenType.GreaterEqual, TokenType.GreaterThan, TokenType.Eof]);
  });

  it("disambiguates :: vs :", () => {
    expect(types(":: :")).toEqual([TokenType.BindState, TokenType.Colon, TokenType.Eof]);
  });

  it("disambiguates == vs => vs =", () => {
    expect(types("== => =")).toEqual([
      TokenType.EqualsEquals,
      TokenType.ThickArrow,
      TokenType.Equals,
      TokenType.Eof,
    ]);
  });

  it("disambiguates != vs !", () => {
    expect(types("!= !")).toEqual([TokenType.BangEquals, TokenType.Bang, TokenType.Eof]);
  });

  it("recognises && and ||", () => {
    expect(types("&& ||")).toEqual([TokenType.LogicalAnd, TokenType.LogicalOr, TokenType.Eof]);
  });

  it("recognises arithmetic operators", () => {
    expect(types("+ - * / %")).toEqual([
      TokenType.Plus,
      TokenType.Minus,
      TokenType.Star,
      TokenType.Slash,
      TokenType.Percent,
      TokenType.Eof,
    ]);
  });

  it("recognises pipe", () => {
    expect(types("|")).toEqual([TokenType.Pipe, TokenType.Eof]);
  });

  it("preserves operator lexemes verbatim", () => {
    const toks = new Scanner("<- -> <-> <:").scanAll();
    expect(toks[0]!.lexeme).toBe("<-");
    expect(toks[1]!.lexeme).toBe("->");
    expect(toks[2]!.lexeme).toBe("<->");
    expect(toks[3]!.lexeme).toBe("<:");
  });

  it("handles operators with no whitespace", () => {
    expect(types("x<-y")).toEqual([
      TokenType.Identifier,
      TokenType.AssignLeft,
      TokenType.Identifier,
      TokenType.Eof,
    ]);
  });

  it("emits a stray '&' diagnostic but keeps lexing", () => {
    const scanner = new Scanner("a & b");
    scanner.scanAll();
    expect(scanner.diagnostics.length).toBeGreaterThan(0);
    expect(scanner.diagnostics[0]!.code).toBe("MOD-L002");
  });

  it("recognises punctuation", () => {
    expect(types("( ) [ ] { } , ; . ?")).toEqual([
      TokenType.LParen,
      TokenType.RParen,
      TokenType.LBracket,
      TokenType.RBracket,
      TokenType.LBrace,
      TokenType.RBrace,
      TokenType.Comma,
      TokenType.Semicolon,
      TokenType.Dot,
      TokenType.Question,
      TokenType.Eof,
    ]);
  });
});
