import { describe, it, expect } from "vitest";
import { firstDecl } from "./helpers.js";

function firstStmt(src: string): { kind: string } {
  const decl = firstDecl(src);
  if (decl.kind !== "ComponentDecl") throw new Error("type guard: expected ComponentDecl");
  return decl.body.items[0]!;
}

describe("Bindings — :: <- <-> -> <:", () => {
  it("parses BindStmt for `Element :: ref` at statement position", () => {
    const stmt = firstStmt(`
      Component: C -> (
        InputField::Email
      )
    `);
    expect(stmt.kind).toBe("BindStmt");
    const b = stmt as { element: { name: string }; target: { name: string } };
    expect(b.element.name).toBe("InputField");
    expect(b.target.name).toBe("Email");
  });

  it("parses BindStmt with trailing inline attributes", () => {
    const stmt = firstStmt(`
      Component: C -> (
        InputField::Email placeholder: "Enter email"
      )
    `);
    if (stmt.kind !== "BindStmt") throw new Error("type guard");
    const b = stmt as unknown as { attrs: { entries: { key: { name: string } }[] } | null };
    expect(b.attrs?.entries[0]!.key.name).toBe("placeholder");
  });

  it("parses ReactiveAssignStmt for `name <- expr`", () => {
    const stmt = firstStmt(`
      Component: C -> (
        CartCount <- CartCount + 1
      )
    `);
    expect(stmt.kind).toBe("ReactiveAssignStmt");
    const r = stmt as unknown as {
      target: { name: string };
      value: { kind: string };
    };
    expect(r.target.name).toBe("CartCount");
    expect(r.value.kind).toBe("Binary");
  });

  it("parses SyncStmt for `a <-> b`", () => {
    const stmt = firstStmt(`
      Component: C -> (
        Foo <-> Bar
      )
    `);
    expect(stmt.kind).toBe("SyncStmt");
  });

  it("parses EventWireStmt for `Event -> Handler`", () => {
    const stmt = firstStmt(`
      Component: C -> (
        Click -> Submit
      )
    `);
    expect(stmt.kind).toBe("EventWireStmt");
    const e = stmt as unknown as {
      event: { name: string };
      handler: { kind: string };
    };
    expect(e.event.name).toBe("Click");
    expect(e.handler.kind).toBe("Identifier");
  });

  it("parses EventWireStmt with parenthesised handler block", () => {
    const stmt = firstStmt(`
      Component: C -> (
        Click -> ( CartCount <- CartCount + 1 )
      )
    `);
    if (stmt.kind !== "EventWireStmt") throw new Error("type guard");
    const e = stmt as unknown as { handler: { kind: string } };
    expect(e.handler.kind).toBe("Block");
  });

  it("parses ApplyEffectStmt for `target <: Effect`", () => {
    const stmt = firstStmt(`
      Component: C -> (
        target <: HoverEffect(pop)
      )
    `);
    expect(stmt.kind).toBe("ApplyEffectStmt");
    const a = stmt as unknown as { target: { kind: string }; effect: { kind: string } };
    expect(a.target.kind).toBe("Identifier");
    expect(a.effect.kind).toBe("Call");
  });

  it("parses 'On Event -> body' as an EventWireStmt", () => {
    const stmt = firstStmt(`
      Component: C -> (
        On Click -> ( CartCount <- 0 )
      )
    `);
    expect(stmt.kind).toBe("EventWireStmt");
  });
});
