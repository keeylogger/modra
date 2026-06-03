import { describe, it, expect } from "vitest";
import { firstDecl } from "./helpers.js";

function firstStmt(src: string): { kind: string } {
  const decl = firstDecl(src);
  if (decl.kind !== "ComponentDecl" && decl.kind !== "ActionDecl") {
    throw new Error("expected Component/Action holder");
  }
  return decl.body.items[0]!;
}

describe("Control-flow statements", () => {
  it("parses if -> body", () => {
    const s = firstStmt(`
      Component: C -> (
        if X > 0 -> ( Return: X )
      )
    `);
    expect(s.kind).toBe("IfStmt");
    const i = s as unknown as { branches: { condition: unknown; body: unknown }[] };
    expect(i.branches).toHaveLength(1);
    expect(i.branches[0]!.condition).not.toBeNull();
  });

  it("parses if / elif / else chain", () => {
    const s = firstStmt(`
      Component: C -> (
        if a -> ( Return: 1 )
        elif b -> ( Return: 2 )
        else -> ( Return: 3 )
      )
    `);
    if (s.kind !== "IfStmt") throw new Error("type guard");
    const i = s as unknown as { branches: { condition: unknown }[] };
    expect(i.branches).toHaveLength(3);
    expect(i.branches[2]!.condition).toBeNull();
  });

  it("parses while loop", () => {
    const s = firstStmt(`
      Component: C -> (
        while Count > 0 -> ( Count <- Count - 1 )
      )
    `);
    expect(s.kind).toBe("WhileStmt");
  });

  it("parses forEach loop with binding", () => {
    const s = firstStmt(`
      Component: C -> (
        forEach u in users -> ( Show: Toast(u.name) )
      )
    `);
    expect(s.kind).toBe("ForEachStmt");
    const f = s as unknown as { binding: { name: string }; iterable: { name: string } };
    expect(f.binding.name).toBe("u");
    expect(f.iterable.name).toBe("users");
  });

  it("parses forEach with 'as' binding", () => {
    const s = firstStmt(`
      Component: C -> (
        forEach item in items as it -> ( Show: Toast(it.name) )
      )
    `);
    if (s.kind !== "ForEachStmt") throw new Error("type guard");
    const f = s as unknown as { binding: { name: string } };
    expect(f.binding.name).toBe("it");
  });

  it("parses infinite loop", () => {
    const s = firstStmt(`
      Component: C -> (
        loop -> ( Count <- Count + 1 )
      )
    `);
    expect(s.kind).toBe("LoopStmt");
  });

  it("parses repeat-times", () => {
    const s = firstStmt(`
      Component: C -> (
        repeat 5 times -> ( Show: Toast("Tick") )
      )
    `);
    expect(s.kind).toBe("RepeatStmt");
  });

  it("parses match with case / otherwise", () => {
    const s = firstStmt(`
      Component: C -> (
        match X (
          case 0 -> ( Return: "zero" )
          case 1 -> ( Return: "one" )
          otherwise -> ( Return: "many" )
        )
      )
    `);
    expect(s.kind).toBe("MatchStmt");
    const m = s as unknown as { cases: { pattern: unknown }[] };
    expect(m.cases).toHaveLength(3);
    expect(m.cases[2]!.pattern).toBeNull();
  });

  it("parses transaction / parallel / sequence blocks", () => {
    const t = firstStmt(`Component: C -> ( transaction -> ( Return: 1 ) )`);
    const p = firstStmt(`Component: C -> ( parallel -> ( Return: 1 ) )`);
    const sq = firstStmt(`Component: C -> ( sequence -> ( Return: 1 ) )`);
    expect(t.kind).toBe("TransactionStmt");
    expect(p.kind).toBe("ParallelStmt");
    expect(sq.kind).toBe("SequenceStmt");
  });

  it("parses Return / Throw / Yield jump statements", () => {
    const r = firstStmt(`Component: C -> ( Return: 42 )`);
    const t = firstStmt(`Component: C -> ( Throw: Error("oops") )`);
    const y = firstStmt(`Component: C -> ( Yield: x )`);
    expect(r.kind).toBe("ReturnStmt");
    expect(t.kind).toBe("ThrowStmt");
    expect(y.kind).toBe("YieldStmt");
  });

  it("parses Break and Continue", () => {
    const b = firstStmt(`Component: C -> ( Break )`);
    const c = firstStmt(`Component: C -> ( Continue )`);
    expect(b.kind).toBe("BreakStmt");
    expect(c.kind).toBe("ContinueStmt");
  });
});
