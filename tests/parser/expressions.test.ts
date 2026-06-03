import { describe, it, expect } from "vitest";
import { expr } from "./helpers.js";

describe("Pratt expression parser — precedence and associativity", () => {
  it("respects multiplicative > additive precedence", () => {
    const e = expr("1 + 2 * 3");
    expect(e.kind).toBe("Binary");
    if (e.kind !== "Binary") throw new Error("type guard");
    expect(e.operator).toBe("+");
    expect(e.right.kind).toBe("Binary");
  });

  it("respects additive > comparison precedence", () => {
    const e = expr("a + b < c + d");
    if (e.kind !== "Binary") throw new Error("type guard");
    expect(e.operator).toBe("<");
    expect(e.left.kind).toBe("Binary");
    expect(e.right.kind).toBe("Binary");
  });

  it("respects comparison > logical-and precedence", () => {
    const e = expr("a < b and c > d");
    if (e.kind !== "Binary") throw new Error("type guard");
    expect(e.operator).toBe("and");
    expect(e.left.kind).toBe("Binary");
    expect(e.right.kind).toBe("Binary");
  });

  it("respects and > or precedence (or binds least tightly)", () => {
    const e = expr("a or b and c");
    if (e.kind !== "Binary") throw new Error("type guard");
    expect(e.operator).toBe("or");
    if (e.right.kind !== "Binary") throw new Error("type guard");
    expect(e.right.operator).toBe("and");
  });

  it("left-associates + at the same level", () => {
    const e = expr("a + b + c");
    if (e.kind !== "Binary") throw new Error("type guard");
    expect(e.operator).toBe("+");
    expect(e.left.kind).toBe("Binary");
    expect(e.right.kind).toBe("Identifier");
  });

  it("handles 'is not' as a single binary operator", () => {
    const e = expr("a is not b");
    if (e.kind !== "Binary") throw new Error("type guard");
    expect(e.operator).toBe("is not");
  });

  it("symbolic && and || are equivalent to and / or", () => {
    const a = expr("x && y");
    const o = expr("x || y");
    if (a.kind !== "Binary" || o.kind !== "Binary") throw new Error("type guard");
    expect(a.operator).toBe("&&");
    expect(o.operator).toBe("||");
  });

  it("treats unary minus as prefix", () => {
    const e = expr("-x");
    expect(e.kind).toBe("Unary");
    if (e.kind !== "Unary") throw new Error("type guard");
    expect(e.operator).toBe("-");
    expect(e.operand.kind).toBe("Identifier");
  });

  it("treats 'not' as prefix", () => {
    const e = expr("not active");
    if (e.kind !== "Unary") throw new Error("type guard");
    expect(e.operator).toBe("not");
  });

  it("parses parenthesised grouping that overrides precedence", () => {
    const e = expr("(a + b) * c");
    if (e.kind !== "Binary") throw new Error("type guard");
    expect(e.operator).toBe("*");
    expect(e.left.kind).toBe("ParenExpr");
  });

  it("parses inline if-then-else expressions", () => {
    const e = expr("if cond then 1 else 2");
    expect(e.kind).toBe("Conditional");
    if (e.kind !== "Conditional") throw new Error("type guard");
    expect(e.consequent.kind).toBe("NumberLit");
    expect(e.alternate?.kind).toBe("NumberLit");
  });

  it("parses inline if-then without else (alternate is null)", () => {
    const e = expr("if cond then 1");
    if (e.kind !== "Conditional") throw new Error("type guard");
    expect(e.alternate).toBeNull();
  });

  it("parses pipe as left-associative", () => {
    const e = expr("a | b | c");
    if (e.kind !== "Binary") throw new Error("type guard");
    expect(e.operator).toBe("|");
    expect(e.left.kind).toBe("Binary");
  });

  it("parses contains/matches/in/notIn as binary keywords", () => {
    for (const op of ["contains", "matches", "in", "notIn"] as const) {
      const e = expr(`a ${op} b`);
      if (e.kind !== "Binary") throw new Error("type guard");
      expect(e.operator).toBe(op);
    }
  });

  it("parses between/within/outside as comparison-level binary operators", () => {
    for (const op of ["between", "within", "outside"] as const) {
      const e = expr(`x ${op} y`);
      if (e.kind !== "Binary") throw new Error("type guard");
      expect(e.operator).toBe(op);
    }
  });

  it("preserves spans on binary expressions", () => {
    const e = expr("alpha + beta");
    expect(e.span.start.column).toBe(1);
    expect(e.span.end.column).toBeGreaterThan(10);
  });
});
