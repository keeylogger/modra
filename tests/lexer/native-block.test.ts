import { describe, it, expect } from "vitest";
import { Scanner, TokenType } from "../../src/index.js";

const NATIVE_PRELUDE = "Native<Python>(in: x; out: y)";

describe("native blocks (Native<Lang>(...) { ... })", () => {
  it("captures a simple native body verbatim", () => {
    const src = `${NATIVE_PRELUDE} { y = x + 1 }`;
    const toks = new Scanner(src).scanAll();
    const body = toks.find((t) => t.type === TokenType.NativeBody);
    expect(body).toBeDefined();
    expect(body!.value).toBe(" y = x + 1 ");
  });

  it("emits Keyword(Native) before the body", () => {
    const src = `${NATIVE_PRELUDE} { pass }`;
    const toks = new Scanner(src).scanAll();
    expect(toks[0]!.type).toBe(TokenType.Keyword);
    expect(toks[0]!.keyword).toBe("Native");
  });

  it("preserves Modra tokens in the prelude (<, identifier, >, parens, …)", () => {
    const src = `${NATIVE_PRELUDE} { x }`;
    const toks = new Scanner(src).scanAll();
    const kinds = toks.map((t) => t.type);
    expect(kinds).toContain(TokenType.LessThan);
    expect(kinds).toContain(TokenType.GreaterThan);
    expect(kinds).toContain(TokenType.LParen);
    expect(kinds).toContain(TokenType.RParen);
    expect(kinds).toContain(TokenType.LBrace);
    expect(kinds).toContain(TokenType.NativeBody);
    expect(kinds).toContain(TokenType.RBrace);
  });

  it("balances nested braces inside the body", () => {
    const src = `${NATIVE_PRELUDE} { if (a) { b } else { c } }`;
    const toks = new Scanner(src).scanAll();
    const body = toks.find((t) => t.type === TokenType.NativeBody);
    expect(body!.value).toBe(" if (a) { b } else { c } ");
  });

  it("handles multi-line native bodies", () => {
    const src = `${NATIVE_PRELUDE} {
    import bcrypt
    y = bcrypt.hashpw(x, bcrypt.gensalt())
  }`;
    const toks = new Scanner(src).scanAll();
    const body = toks.find((t) => t.type === TokenType.NativeBody);
    expect(body).toBeDefined();
    expect(typeof body!.value).toBe("string");
    expect(body!.value as string).toContain("import bcrypt");
    expect(body!.value as string).toContain("bcrypt.hashpw");
  });

  it("does NOT interpret string syntax inside the body", () => {
    const src = `${NATIVE_PRELUDE} { y = "hello" + 'world' }`;
    const toks = new Scanner(src).scanAll();
    const body = toks.find((t) => t.type === TokenType.NativeBody);
    expect(body!.value).toBe(` y = "hello" + 'world' `);
    // The verbatim body means we should NOT have seen a StringLiteral token.
    expect(toks.some((t) => t.type === TokenType.StringLiteral)).toBe(false);
  });

  it("emits a diagnostic for unbalanced native blocks", () => {
    const src = `${NATIVE_PRELUDE} { y = unclosed`;
    const scanner = new Scanner(src);
    scanner.scanAll();
    expect(scanner.diagnostics.some((d) => d.code === "MOD-L008")).toBe(true);
  });

  it("after the native body, mode returns to Modra", () => {
    const src = `${NATIVE_PRELUDE} { body } x <- 5`;
    const toks = new Scanner(src).scanAll();
    const idx = toks.findIndex((t) => t.type === TokenType.RBrace);
    expect(idx).toBeGreaterThan(-1);
    expect(toks[idx + 1]!.type).toBe(TokenType.Identifier);
    expect(toks[idx + 1]!.value).toBe("x");
    expect(toks[idx + 2]!.type).toBe(TokenType.AssignLeft);
  });

  it("a brace after a non-native expression is NOT a native body", () => {
    const src = "Action: Foo -> { x }";
    const toks = new Scanner(src).scanAll();
    expect(toks.some((t) => t.type === TokenType.NativeBody)).toBe(false);
  });
});
