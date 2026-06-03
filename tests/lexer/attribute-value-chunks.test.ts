import { describe, it, expect } from "vitest";
import { Scanner, TokenType } from "../../src/index.js";

/**
 * Attribute / value chunks are a key conciseness feature: an attribute
 * declaration like `placeholder: "Enter name"` should produce 3 tokens
 * (Identifier, Colon, StringLiteral), and the reactive form
 * `Text: Status <- "Cart: {CartCount}"` should produce a clean,
 * predictable token stream including the StringChunk + InjectStart +
 * Identifier + InjectEnd + StringChunk sequence.
 */
describe("attribute-value chunks", () => {
  it("static attribute is three tokens", () => {
    const toks = new Scanner('placeholder: "Enter name"').scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.Identifier,
      TokenType.Colon,
      TokenType.StringLiteral,
      TokenType.Eof,
    ]);
    expect(toks[2]!.value).toBe("Enter name");
  });

  it("reactive attribute uses <- and tokenises the RHS", () => {
    const toks = new Scanner('Text: Status <- "Cart: {CartCount}"').scanAll();
    const kinds = toks.map((t) => t.type);
    // We expect: Identifier("Text"), Colon, Identifier("Status"), AssignLeft,
    //   StringChunk("Cart: "), InjectStart, Identifier("CartCount"), InjectEnd, StringChunk(""), Eof
    expect(kinds[0]).toBe(TokenType.Identifier);
    expect(kinds[1]).toBe(TokenType.Colon);
    expect(kinds[2]).toBe(TokenType.Identifier);
    expect(kinds[3]).toBe(TokenType.AssignLeft);
    expect(kinds[4]).toBe(TokenType.StringChunk);
    expect(kinds[5]).toBe(TokenType.InjectStart);
    expect(kinds[6]).toBe(TokenType.Identifier);
    expect(kinds[7]).toBe(TokenType.InjectEnd);
    expect(kinds[8]).toBe(TokenType.StringChunk);
  });

  it("two-way bind shorthand: InputField::Email yields three tokens", () => {
    const toks = new Scanner("InputField::Email").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.Identifier,
      TokenType.BindState,
      TokenType.Identifier,
      TokenType.Eof,
    ]);
  });

  it("event wire: Click -> SubmitForm yields three tokens", () => {
    const toks = new Scanner("Click -> SubmitForm").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.Identifier,
      TokenType.FlowRight,
      TokenType.Identifier,
      TokenType.Eof,
    ]);
  });

  it("apply-effect: url <: HoverEffect(pop) yields five tokens", () => {
    const toks = new Scanner('"https://x.com" <: HoverEffect(pop)').scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.StringLiteral,
      TokenType.ApplyEffect,
      TokenType.Identifier,
      TokenType.LParen,
      TokenType.Identifier,
      TokenType.RParen,
      TokenType.Eof,
    ]);
  });

  it("enum access via dot: Size.Medium yields three tokens", () => {
    const toks = new Scanner("Size.Medium").scanAll();
    expect(toks.map((t) => t.type)).toEqual([
      TokenType.Identifier,
      TokenType.Dot,
      TokenType.Identifier,
      TokenType.Eof,
    ]);
  });

  it("dense, real-world line tokenises cleanly", () => {
    const src = "Submit  Click -> SubmitRegistration label: \"Register\"";
    const toks = new Scanner(src).scanAll();
    const kinds = toks.map((t) => t.type);
    expect(kinds).toEqual([
      TokenType.Identifier,
      TokenType.Identifier,
      TokenType.FlowRight,
      TokenType.Identifier,
      TokenType.Identifier,
      TokenType.Colon,
      TokenType.StringLiteral,
      TokenType.Eof,
    ]);
  });
});
