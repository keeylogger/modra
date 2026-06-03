import { describe, it, expect } from "vitest";
import { expr } from "./helpers.js";

describe("Atoms — literals", () => {
  it("parses positive integers", () => {
    const e = expr("42");
    if (e.kind !== "NumberLit") throw new Error("type guard");
    expect(e.value).toBe(42);
    expect(e.raw).toBe("42");
  });

  it("parses fractional numbers", () => {
    const e = expr("3.14");
    if (e.kind !== "NumberLit") throw new Error("type guard");
    expect(e.value).toBeCloseTo(3.14);
  });

  it("parses simple double-quoted strings", () => {
    const e = expr('"hello"');
    if (e.kind !== "StringLit") throw new Error("type guard");
    expect(e.value).toBe("hello");
  });

  it("parses strings with escape sequences", () => {
    const e = expr('"line\\nbreak"');
    if (e.kind !== "StringLit") throw new Error("type guard");
    expect(e.value).toBe("line\nbreak");
  });

  it("parses interpolated strings with a single placeholder", () => {
    const e = expr('"Hello {Name}"');
    expect(e.kind).toBe("InterpolatedStringLit");
    if (e.kind !== "InterpolatedStringLit") throw new Error("type guard");
    // Expect chunks + identifier interleaved.
    const kinds = e.parts.map((p) => p.kind);
    expect(kinds).toContain("StringChunkPart");
    expect(kinds).toContain("Identifier");
  });

  it("parses interpolated strings with expression placeholders", () => {
    const e = expr('"Total: {price * qty}"');
    if (e.kind !== "InterpolatedStringLit") throw new Error("type guard");
    const exprPart = e.parts.find((p) => p.kind === "Binary");
    expect(exprPart).toBeDefined();
  });

  it("parses booleans", () => {
    const t = expr("true");
    const f = expr("false");
    if (t.kind !== "BoolLit" || f.kind !== "BoolLit") throw new Error("type guard");
    expect(t.value).toBe(true);
    expect(f.value).toBe(false);
  });

  it("parses 'none' as NoneLit (not a keyword expression)", () => {
    const e = expr("none");
    expect(e.kind).toBe("NoneLit");
  });

  it("parses hex colour literals (6-digit)", () => {
    const e = expr("#1D1D1F");
    if (e.kind !== "HexColorLit") throw new Error("type guard");
    expect(e.value).toBe("#1D1D1F");
  });

  it("parses hex colour literals (8-digit alpha)", () => {
    const e = expr("#FF3B30CC");
    if (e.kind !== "HexColorLit") throw new Error("type guard");
    expect(e.value).toBe("#FF3B30CC");
  });

  it("parses empty array literal []", () => {
    const e = expr("[]");
    if (e.kind !== "ArrayLit") throw new Error("type guard");
    expect(e.items).toHaveLength(0);
  });

  it("parses array literals with mixed element kinds", () => {
    const e = expr('[1, "two", true, none]');
    if (e.kind !== "ArrayLit") throw new Error("type guard");
    expect(e.items.map((i) => i.kind)).toEqual(["NumberLit", "StringLit", "BoolLit", "NoneLit"]);
  });

  it("parses nested array literals", () => {
    const e = expr("[[1, 2], [3, 4]]");
    if (e.kind !== "ArrayLit") throw new Error("type guard");
    expect(e.items[0]!.kind).toBe("ArrayLit");
  });

  it("parses object literal with named keys", () => {
    const e = expr('{ name: "Joe", age: 32 }');
    if (e.kind !== "ObjectLit") throw new Error("type guard");
    expect(e.entries).toHaveLength(2);
    expect(e.entries[0]!.key.name).toBe("name");
    expect(e.entries[1]!.key.name).toBe("age");
  });

  it("parses empty object literal { }", () => {
    const e = expr("{}");
    if (e.kind !== "ObjectLit") throw new Error("type guard");
    expect(e.entries).toHaveLength(0);
  });

  it("parses @{ … } injection literal at expression position", () => {
    const e = expr("@{count * 2}");
    if (e.kind !== "Injection") throw new Error("type guard");
    expect(e.expression.kind).toBe("Binary");
  });
});
