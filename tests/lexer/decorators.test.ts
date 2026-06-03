import { describe, it, expect } from "vitest";
import { Scanner, TokenType } from "../../src/index.js";

describe("decorators (@Identifier)", () => {
  it("recognises a simple decorator", () => {
    const toks = new Scanner("@Primary").scanAll();
    expect(toks[0]!.type).toBe(TokenType.Decorator);
    expect(toks[0]!.lexeme).toBe("@Primary");
    expect(toks[0]!.value).toBe("Primary");
  });

  it("handles a decorator followed by parens (the parser will read args)", () => {
    const toks = new Scanner("@ForeignKey(Users.ID)").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.Decorator,
      TokenType.LParen,
      TokenType.Identifier,
      TokenType.Dot,
      TokenType.Identifier,
      TokenType.RParen,
      TokenType.Eof,
    ]);
    expect(toks[0]!.value).toBe("ForeignKey");
  });

  it("handles back-to-back decorators on different lines", () => {
    const toks = new Scanner("@Primary\n@Unique").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.Decorator,
      TokenType.Decorator,
      TokenType.Eof,
    ]);
    expect(toks[0]!.value).toBe("Primary");
    expect(toks[1]!.value).toBe("Unique");
  });

  it("a decorator is not a directive: '@A' vs '@@A'", () => {
    const a = new Scanner("@A").scanAll()[0]!;
    const aa = new Scanner("@@A").scanAll();
    expect(a.type).toBe(TokenType.Decorator);
    expect(aa[0]!.type).toBe(TokenType.DirectiveAt);
    expect(aa[1]!.type).toBe(TokenType.Identifier);
  });

  it("emits a diagnostic for a stray '@' followed by non-identifier", () => {
    const scanner = new Scanner("@ ");
    scanner.scanAll();
    expect(scanner.diagnostics.some((d) => d.code === "MOD-L003")).toBe(true);
  });

  it("preserves the original lexeme verbatim", () => {
    const tok = new Scanner("@CamelCaseName").scanAll()[0]!;
    expect(tok.lexeme).toBe("@CamelCaseName");
  });

  it("a decorator on a column inside an expression scans cleanly", () => {
    // 'String' here is a built-in type identifier, not a structural keyword.
    const toks = new Scanner("String: Email @Unique").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.Identifier,
      TokenType.Colon,
      TokenType.Identifier,
      TokenType.Decorator,
      TokenType.Eof,
    ]);
  });
});
