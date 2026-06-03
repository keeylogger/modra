import { describe, it, expect } from "vitest";
import { firstDecl, parseOk } from "./helpers.js";

describe("Decorators", () => {
  it("attaches a single decorator above a Style declaration", () => {
    const decl = firstDecl(`
      @Reusable
      Style: Card (
        Color: Border <- #000000
      )
    `);
    if (decl.kind !== "StyleDecl") throw new Error("type guard");
    expect(decl.decorators).toHaveLength(1);
    expect(decl.decorators[0]!.name.name).toBe("Reusable");
  });

  it("stacks multiple decorators above a Component", () => {
    const decl = firstDecl(`
      @Memoized
      @Tested
      Component: Card -> (
        Title: "X"
      )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    expect(decl.decorators.map((d) => d.name.name)).toEqual(["Memoized", "Tested"]);
  });

  it("parses decorator arguments", () => {
    const decl = firstDecl(`
      @Route("/users/:id")
      Endpoint: GetUser(Id: String) -> (
        Return: Id
      )
    `);
    if (decl.kind !== "EndpointDecl") throw new Error("type guard");
    const d = decl.decorators[0]!;
    expect(d.name.name).toBe("Route");
    expect(d.args).toHaveLength(1);
    expect(d.args[0]!.kind).toBe("StringLit");
  });

  it("attaches trailing column decorators (Primary, Unique, Indexed)", () => {
    const ast = parseOk(`
      Database: Postgres -> (
        Table: T -> (
          String: ID @Primary
          String: Email @Unique @Indexed
        )
      )
    `);
    const db = ast.declarations[0]!;
    if (db.kind !== "DatabaseDecl") throw new Error("type guard");
    const cols = db.tables[0]!.columns;
    expect(cols[0]!.decorators).toHaveLength(1);
    expect(cols[1]!.decorators.map((d) => d.name.name)).toEqual(["Unique", "Indexed"]);
  });

  it("attaches decorators to Type declarations", () => {
    const decl = firstDecl(`Type: Email: String @Format(email)`);
    if (decl.kind !== "TypeDecl") throw new Error("type guard");
    expect(decl.decorators[0]!.name.name).toBe("Format");
    expect(decl.decorators[0]!.args[0]!.kind).toBe("Identifier");
  });

  it("preserves spans on each decorator", () => {
    const decl = firstDecl(`
      @Memoized
      Component: X -> ( Title: "X" )
    `);
    if (decl.kind !== "ComponentDecl") throw new Error("type guard");
    expect(decl.decorators[0]!.span.start.line).toBeGreaterThan(0);
  });
});
