import { describe, it, expect } from "vitest";
import { Scanner, TokenType } from "../../src/index.js";

describe("directives (@@identifier)", () => {
  it("recognises a bare @@strict", () => {
    const toks = new Scanner("@@strict").scanAll();
    expect(toks[0]!.type).toBe(TokenType.DirectiveAt);
    expect(toks[0]!.lexeme).toBe("@@");
    expect(toks[1]!.type).toBe(TokenType.Identifier);
    expect(toks[1]!.value).toBe("strict");
  });

  it("recognises @@target: Server as four tokens", () => {
    const toks = new Scanner("@@target: Server").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.DirectiveAt,
      TokenType.Identifier,
      TokenType.Colon,
      TokenType.Identifier,
      TokenType.Eof,
    ]);
    expect(toks[1]!.value).toBe("target");
    expect(toks[3]!.value).toBe("Server");
  });

  it("@@experimental(feature) parses with parens", () => {
    const toks = new Scanner("@@experimental(nativeBridges)").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.DirectiveAt,
      TokenType.Identifier,
      TokenType.LParen,
      TokenType.Identifier,
      TokenType.RParen,
      TokenType.Eof,
    ]);
  });

  it("multiple directives on consecutive lines", () => {
    const toks = new Scanner("@@strict\n@@target: Server").scanAll();
    const directiveTokens = toks.filter((t) => t.type === TokenType.DirectiveAt);
    expect(directiveTokens).toHaveLength(2);
  });

  it("@@reactive: off scans as four tokens", () => {
    const toks = new Scanner("@@reactive: off").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.DirectiveAt,
      TokenType.Identifier,
      TokenType.Colon,
      TokenType.Identifier,
      TokenType.Eof,
    ]);
    expect(toks[3]!.value).toBe("off");
  });

  it("@@case: PascalCase scans cleanly", () => {
    const toks = new Scanner("@@case: PascalCase").scanAll();
    expect(toks[0]!.type).toBe(TokenType.DirectiveAt);
    expect(toks[1]!.value).toBe("case");
    expect(toks[3]!.value).toBe("PascalCase");
  });

  it("a directive followed by code keeps tokens separated", () => {
    const toks = new Scanner("@@strict\nNumber: X <- 0").scanAll();
    expect(toks[0]!.type).toBe(TokenType.DirectiveAt);
    expect(toks[1]!.value).toBe("strict");
    // Number is a built-in type identifier, not a structural keyword.
    expect(toks[2]!.type).toBe(TokenType.Identifier);
    expect(toks[2]!.value).toBe("Number");
    expect(toks[3]!.type).toBe(TokenType.Colon);
  });

  it("DirectiveAt token has the right lexeme", () => {
    const tok = new Scanner("@@").scanAll()[0]!;
    expect(tok.lexeme).toBe("@@");
    expect(tok.value).toBe("@@");
  });
});
