import { describe, it, expect } from "vitest";
import { Scanner, TokenType } from "../../src/index.js";

/**
 * Mode-stack regression tests. These exercise the lexer's ability to
 * push, nest, and pop the four modes (Modra, Injection, NativeBody,
 * String) and recover to the right level after each terminator.
 */
describe("mode-stack context switching", () => {
  it("string → injection → string → injection (deep alternation)", () => {
    const src = '"a {b} c {d} e"';
    const toks = new Scanner(src).scanAll();
    const kinds = toks.map((t) => t.type);
    expect(kinds.filter((k) => k === TokenType.InjectStart).length).toBe(2);
    expect(kinds.filter((k) => k === TokenType.InjectEnd).length).toBe(2);
    expect(kinds.filter((k) => k === TokenType.StringChunk).length).toBe(3);
    expect(kinds.filter((k) => k === TokenType.Identifier).length).toBe(2);
  });

  it("injection containing a string containing an injection", () => {
    const src = '@{ "left{mid}right" }';
    const toks = new Scanner(src).scanAll();
    const kinds = toks.map((t) => t.type);
    expect(kinds.filter((k) => k === TokenType.InjectStart).length).toBe(2);
    expect(kinds.filter((k) => k === TokenType.InjectEnd).length).toBe(2);
    expect(kinds.filter((k) => k === TokenType.StringChunk).length).toBe(2);
  });

  it("native body inside an action body works (modes don't bleed)", () => {
    const src = "Action: X -> ( Native<Python>() { y = 1 } )";
    const toks = new Scanner(src).scanAll();
    const kinds = toks.map((t) => t.type);
    expect(kinds).toContain(TokenType.NativeBody);
    expect(kinds[kinds.length - 1]).toBe(TokenType.Eof);
    // The final RParen / RBrace tokens should be present at top level.
    expect(kinds.slice(-3, -1)).toEqual([TokenType.RBrace, TokenType.RParen]);
  });

  it("after closing a string, top of stack returns to Modra", () => {
    const src = '"hi" + 1';
    const toks = new Scanner(src).scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.StringLiteral,
      TokenType.Plus,
      TokenType.NumberLiteral,
      TokenType.Eof,
    ]);
  });

  it("after closing an injection, top of stack returns to Modra", () => {
    const src = "@{ 1 } + 2";
    const toks = new Scanner(src).scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.InjectStart,
      TokenType.NumberLiteral,
      TokenType.InjectEnd,
      TokenType.Plus,
      TokenType.NumberLiteral,
      TokenType.Eof,
    ]);
  });

  it("multiple back-to-back strings each pop cleanly", () => {
    const toks = new Scanner('"a" "b" "c"').scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.StringLiteral,
      TokenType.StringLiteral,
      TokenType.StringLiteral,
      TokenType.Eof,
    ]);
  });

  it("native body containing brace-like Modra characters does not push String mode", () => {
    const src = 'Native<JavaScript>() { window.foo({a: 1}) }';
    const toks = new Scanner(src).scanAll();
    const body = toks.find((t) => t.type === TokenType.NativeBody);
    expect(body!.value).toBe(" window.foo({a: 1}) ");
    expect(toks.filter((t) => t.type === TokenType.StringLiteral).length).toBe(0);
  });
});
