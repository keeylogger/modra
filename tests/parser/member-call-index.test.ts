import { describe, it, expect } from "vitest";
import { expr } from "./helpers.js";

describe("Atoms — member / call / index access", () => {
  it("parses single member access", () => {
    const e = expr("user.name");
    if (e.kind !== "Member") throw new Error("type guard");
    expect(e.property.name).toBe("name");
    expect(e.object.kind).toBe("Identifier");
  });

  it("parses chained member access", () => {
    const e = expr("user.profile.name");
    if (e.kind !== "Member") throw new Error("type guard");
    expect(e.property.name).toBe("name");
    expect(e.object.kind).toBe("Member");
  });

  it("parses bare call with no args", () => {
    const e = expr("now()");
    if (e.kind !== "Call") throw new Error("type guard");
    expect(e.args).toHaveLength(0);
    expect(e.callee.kind).toBe("Identifier");
  });

  it("parses positional call args", () => {
    const e = expr("max(a, b, c)");
    if (e.kind !== "Call") throw new Error("type guard");
    expect(e.args).toHaveLength(3);
    for (const a of e.args) expect(a.name).toBeNull();
  });

  it("parses named call args", () => {
    const e = expr('Create(Name: "X", Count: 3)');
    if (e.kind !== "Call") throw new Error("type guard");
    expect(e.args[0]!.name?.name).toBe("Name");
    expect(e.args[1]!.name?.name).toBe("Count");
    expect((e.args[1]!.value as { kind: string }).kind).toBe("NumberLit");
  });

  it("parses mixed positional and named call args", () => {
    const e = expr("rgba(255, 255, 255, alpha: 0.8)");
    if (e.kind !== "Call") throw new Error("type guard");
    expect(e.args).toHaveLength(4);
    expect(e.args[0]!.name).toBeNull();
    expect(e.args[3]!.name?.name).toBe("alpha");
  });

  it("parses simple index expressions", () => {
    const e = expr("xs[0]");
    if (e.kind !== "Index") throw new Error("type guard");
    expect(e.object.kind).toBe("Identifier");
    expect(e.index.kind).toBe("NumberLit");
  });

  it("parses index with expression key", () => {
    const e = expr("map[user.id]");
    if (e.kind !== "Index") throw new Error("type guard");
    expect(e.index.kind).toBe("Member");
  });

  it("chains member.call.member.call patterns", () => {
    const e = expr("DB.Users.Insert(u).then(handler)");
    expect(e.kind).toBe("Call");
    if (e.kind !== "Call") throw new Error("type guard");
    expect(e.callee.kind).toBe("Member");
  });

  it("does not extend bare literals into calls", () => {
    // `3()` would be nonsensical; the parser leaves the `(` alone so
    // it can act as a trailing attr-block in declarative contexts.
    const e = expr("3");
    expect(e.kind).toBe("NumberLit");
  });

  it("preserves left-to-right span across postfix chain", () => {
    const e = expr("a.b(c)[d]");
    expect(e.kind).toBe("Index");
    expect(e.span.start.column).toBe(1);
  });
});
