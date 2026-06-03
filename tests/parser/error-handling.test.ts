import { describe, it, expect } from "vitest";
import { firstDecl } from "./helpers.js";

function firstStmt(src: string): { kind: string } {
  const decl = firstDecl(src);
  if (decl.kind !== "ComponentDecl" && decl.kind !== "ActionDecl") {
    throw new Error("expected Component/Action holder");
  }
  return decl.body.items[0]!;
}

describe("Error-handling and check statements", () => {
  it("parses attempt with body only", () => {
    const s = firstStmt(`
      Component: C -> (
        attempt -> ( Return: doRisky() )
      )
    `);
    expect(s.kind).toBe("AttemptStmt");
    const a = s as unknown as { recoverBody: unknown; ensureBody: unknown };
    expect(a.recoverBody).toBeNull();
    expect(a.ensureBody).toBeNull();
  });

  it("parses attempt with recover", () => {
    const s = firstStmt(`
      Component: C -> (
        attempt -> ( Return: doRisky() )
        recover err -> ( Return: err )
      )
    `);
    if (s.kind !== "AttemptStmt") throw new Error("type guard");
    const a = s as unknown as { recoverBinding: { name: string }; recoverBody: unknown };
    expect(a.recoverBinding.name).toBe("err");
    expect(a.recoverBody).not.toBeNull();
  });

  it("parses attempt with recover and ensure", () => {
    const s = firstStmt(`
      Component: C -> (
        attempt -> ( Return: doRisky() )
        recover err -> ( Throw: err )
        ensure -> ( Close: Conn )
      )
    `);
    if (s.kind !== "AttemptStmt") throw new Error("type guard");
    const a = s as unknown as { ensureBody: unknown };
    expect(a.ensureBody).not.toBeNull();
  });

  it("parses require / assert / expect statements", () => {
    const r = firstStmt(`Component: C -> ( require x > 0 )`);
    const a = firstStmt(`Component: C -> ( assert y is not none )`);
    const e = firstStmt(`Component: C -> ( expect z matches Pattern )`);
    expect(r.kind).toBe("RequireStmt");
    expect(a.kind).toBe("AssertStmt");
    expect(e.kind).toBe("ExpectStmt");
  });

  it("parses recover without an explicit binding", () => {
    const s = firstStmt(`
      Component: C -> (
        attempt -> ( Return: 1 )
        recover -> ( Return: 0 )
      )
    `);
    if (s.kind !== "AttemptStmt") throw new Error("type guard");
    const a = s as unknown as { recoverBinding: unknown; recoverBody: unknown };
    expect(a.recoverBinding).toBeNull();
    expect(a.recoverBody).not.toBeNull();
  });
});
