import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Scanner, SourceFile, TokenType } from "../../src/index.js";

const here = fileURLToPath(new URL(".", import.meta.url));

function readFixture(name: string): string {
  return readFileSync(resolve(here, "fixtures", name), "utf8");
}

/**
 * The Scanner normalises CRLF/CR to LF before lexing. Round-trip
 * invariants therefore hold against the *normalised* text, not the raw
 * on-disk bytes (which on Windows checkouts are typically CRLF).
 */
function normalise(src: string): string {
  return new SourceFile("<test>", src).normalisedText;
}

describe("end-to-end fixture: storefront.modra", () => {
  const src = readFixture("storefront.modra");

  it("scans without errors", () => {
    const scanner = new Scanner(src, "storefront.modra");
    scanner.scanAll();
    expect(scanner.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("emits the expected mix of token kinds", () => {
    const toks = new Scanner(src).scanAll();
    const kinds = new Set(toks.map((t) => t.type));
    expect(kinds.has(TokenType.Keyword)).toBe(true);
    expect(kinds.has(TokenType.Identifier)).toBe(true);
    expect(kinds.has(TokenType.AssignLeft)).toBe(true);
    expect(kinds.has(TokenType.FlowRight)).toBe(true);
    expect(kinds.has(TokenType.StringLiteral)).toBe(true);
    expect(kinds.has(TokenType.StringChunk)).toBe(true);
    expect(kinds.has(TokenType.HexColor)).toBe(true);
    expect(kinds.has(TokenType.NumberLiteral)).toBe(true);
    expect(kinds.has(TokenType.InjectStart)).toBe(true);
    expect(kinds.has(TokenType.InjectEnd)).toBe(true);
  });

  it("recognises 'using' as a keyword", () => {
    const toks = new Scanner(src).scanAll();
    const first = toks[0]!;
    expect(first.type).toBe(TokenType.Keyword);
    expect(first.keyword).toBe("using");
  });

  it("with keepTrivia, lexemes round-trip to normalised source", () => {
    const toks = new Scanner(src).scanAll({ keepTrivia: true });
    expect(toks.map((t) => t.lexeme).join("")).toBe(normalise(src));
  });

  it("recognises hex colours used in style declarations", () => {
    const toks = new Scanner(src).scanAll();
    const colors = toks.filter((t) => t.type === TokenType.HexColor);
    const values = colors.map((c) => c.value);
    expect(values).toContain("#1D1D1F");
    expect(values).toContain("#E5E5E7");
    expect(values).toContain("#FF3B30");
  });

  it("recognises 'from' as a keyword for inheritance", () => {
    const toks = new Scanner(src).scanAll();
    const froms = toks.filter((t) => t.type === TokenType.Keyword && t.keyword === "from");
    expect(froms.length).toBeGreaterThanOrEqual(2);
  });
});

describe("end-to-end fixture: register-user.modra", () => {
  const src = readFixture("register-user.modra");

  it("scans without errors", () => {
    const scanner = new Scanner(src, "register-user.modra");
    scanner.scanAll();
    expect(scanner.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  });

  it("captures every directive (@@strict, @@target, @@experimental, @@reactive)", () => {
    const toks = new Scanner(src).scanAll();
    const directives = toks.filter((t) => t.type === TokenType.DirectiveAt);
    expect(directives.length).toBeGreaterThanOrEqual(4);
  });

  it("captures @@target: Server as DirectiveAt + Identifier + Colon + Identifier", () => {
    const toks = new Scanner(src).scanAll();
    for (let i = 0; i < toks.length - 3; i++) {
      if (
        toks[i]!.type === TokenType.DirectiveAt &&
        toks[i + 1]!.value === "target" &&
        toks[i + 2]!.type === TokenType.Colon
      ) {
        // 'Server' is a plain identifier here — the parser/semantic
        // phase interprets the value of the @@target directive.
        expect(toks[i + 3]!.type).toBe(TokenType.Identifier);
        expect(toks[i + 3]!.value).toBe("Server");
        return;
      }
    }
    throw new Error("@@target: Server sequence not found in token stream");
  });

  it("captures decorators @Primary and @Unique on Users table columns", () => {
    const toks = new Scanner(src).scanAll();
    const decoratorValues = toks
      .filter((t) => t.type === TokenType.Decorator)
      .map((t) => t.value as string);
    expect(decoratorValues).toContain("Primary");
    expect(decoratorValues).toContain("Unique");
  });

  it("recognises Native<Python>(...) { ... } as a single NativeBody token", () => {
    const toks = new Scanner(src).scanAll();
    const bodies = toks.filter((t) => t.type === TokenType.NativeBody);
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!.value as string).toContain("import bcrypt");
    expect(bodies[0]!.value as string).toContain("bcrypt.hashpw");
  });

  it("recognises __module__ as an identifier", () => {
    const toks = new Scanner(src).scanAll();
    const ids = toks.filter((t) => t.type === TokenType.Identifier).map((t) => t.value);
    expect(ids).toContain("__module__");
  });

  it("recognises InputField::Name as Identifier BindState Identifier", () => {
    const toks = new Scanner(src).scanAll();
    for (let i = 0; i < toks.length - 2; i++) {
      if (
        toks[i]!.type === TokenType.Identifier &&
        toks[i]!.value === "InputField" &&
        toks[i + 1]!.type === TokenType.BindState
      ) {
        expect(toks[i + 2]!.type).toBe(TokenType.Identifier);
        return;
      }
    }
    throw new Error("InputField::Name sequence not found");
  });

  it("with keepTrivia, lexemes round-trip to normalised source", () => {
    const toks = new Scanner(src).scanAll({ keepTrivia: true });
    expect(toks.map((t) => t.lexeme).join("")).toBe(normalise(src));
  });
});
