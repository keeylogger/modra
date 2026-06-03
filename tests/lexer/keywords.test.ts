import { describe, it, expect } from "vitest";
import {
  Scanner,
  TokenType,
  KEYWORDS,
  TITLE_CASE_KEYWORDS,
  LOWERCASE_KEYWORDS,
} from "../../src/index.js";

describe("keywords", () => {
  it("recognises every TitleCase structural keyword", () => {
    for (const kw of TITLE_CASE_KEYWORDS) {
      const toks = new Scanner(kw).scanAll();
      expect(toks[0]!.type).toBe(TokenType.Keyword);
      expect(toks[0]!.keyword).toBe(kw);
    }
  });

  it("recognises every lowercase control-flow keyword", () => {
    for (const kw of LOWERCASE_KEYWORDS) {
      const toks = new Scanner(kw).scanAll();
      if (kw === "true" || kw === "false") {
        expect(toks[0]!.type).toBe(TokenType.BoolLiteral);
        expect(toks[0]!.value).toBe(kw === "true");
        continue;
      }
      expect(toks[0]!.type).toBe(TokenType.Keyword);
      expect(toks[0]!.keyword).toBe(kw);
    }
  });

  it("is case-sensitive: 'if' is a keyword, 'If' is an identifier", () => {
    const ifTok = new Scanner("if").scanAll()[0]!;
    const ifCap = new Scanner("If").scanAll()[0]!;
    expect(ifTok.type).toBe(TokenType.Keyword);
    expect(ifCap.type).toBe(TokenType.Identifier);
  });

  it("'Style' is a keyword, 'style' is an identifier (lowercase application)", () => {
    expect(new Scanner("Style").scanAll()[0]!.type).toBe(TokenType.Keyword);
    expect(new Scanner("style").scanAll()[0]!.type).toBe(TokenType.Identifier);
  });

  it("none is its own literal, not a keyword", () => {
    const tok = new Scanner("none").scanAll()[0]!;
    expect(tok.type).toBe(TokenType.NoneLiteral);
    expect(tok.value).toBeNull();
  });

  it("KEYWORDS map covers exactly the documented sets", () => {
    const all = new Set<string>([...TITLE_CASE_KEYWORDS, ...LOWERCASE_KEYWORDS]);
    expect(KEYWORDS.size).toBe(all.size);
    for (const k of all) {
      expect(KEYWORDS.has(k)).toBe(true);
    }
  });

  it("classifies keyword case correctly", () => {
    expect(KEYWORDS.get("Component")?.case).toBe("title");
    expect(KEYWORDS.get("if")?.case).toBe("lower");
    expect(KEYWORDS.get("from")?.case).toBe("lower");
    expect(KEYWORDS.get("Database")?.case).toBe("title");
  });

  it("recognises true/false as boolean literals", () => {
    const t = new Scanner("true false").scanAll();
    expect(t[0]!.type).toBe(TokenType.BoolLiteral);
    expect(t[0]!.value).toBe(true);
    expect(t[1]!.type).toBe(TokenType.BoolLiteral);
    expect(t[1]!.value).toBe(false);
  });

  it("English logical aliases are lowercase keywords", () => {
    const toks = new Scanner("and or not xor").scanAll();
    expect(toks.slice(0, 4).every((t) => t.type === TokenType.Keyword)).toBe(true);
    expect(toks.map((t) => t.keyword).slice(0, 4)).toEqual(["and", "or", "not", "xor"]);
  });
});
