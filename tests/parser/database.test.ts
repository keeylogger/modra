import { describe, it, expect } from "vitest";
import { firstDecl } from "./helpers.js";

describe("Database declarations", () => {
  it("parses Database with one Table", () => {
    const decl = firstDecl(`
      Database: Postgres -> (
        Table: Users -> (
          String: ID
          String: Name
        )
      )
    `);
    if (decl.kind !== "DatabaseDecl") throw new Error("type guard");
    expect(decl.backend.name).toBe("Postgres");
    expect(decl.tables).toHaveLength(1);
    expect(decl.tables[0]!.name.name).toBe("Users");
    expect(decl.tables[0]!.columns).toHaveLength(2);
  });

  it("parses column types, names and defaults", () => {
    const decl = firstDecl(`
      Database: Postgres -> (
        Table: Users -> (
          String: ID <- UUID()
          Number: Score <- 0
          DateTime: CreatedAt
        )
      )
    `);
    if (decl.kind !== "DatabaseDecl") throw new Error("type guard");
    const cols = decl.tables[0]!.columns;
    expect(cols[0]!.type.name.name).toBe("String");
    expect(cols[0]!.name.name).toBe("ID");
    expect(cols[0]!.init?.kind).toBe("Call");
    expect(cols[1]!.init?.kind).toBe("NumberLit");
    expect(cols[2]!.init).toBeNull();
  });

  it("attaches @Primary / @Unique decorators to columns", () => {
    const decl = firstDecl(`
      Database: Postgres -> (
        Table: Users -> (
          String: ID @Primary
          String: Email @Unique
        )
      )
    `);
    if (decl.kind !== "DatabaseDecl") throw new Error("type guard");
    const cols = decl.tables[0]!.columns;
    expect(cols[0]!.decorators[0]!.name.name).toBe("Primary");
    expect(cols[1]!.decorators[0]!.name.name).toBe("Unique");
  });

  it("parses multiple tables in one Database", () => {
    const decl = firstDecl(`
      Database: Postgres -> (
        Table: Users -> (
          String: ID
        )
        Table: Posts -> (
          String: ID
          String: Body
        )
      )
    `);
    if (decl.kind !== "DatabaseDecl") throw new Error("type guard");
    expect(decl.tables.map((t) => t.name.name)).toEqual(["Users", "Posts"]);
  });

  it("supports generic column types like Array<String>", () => {
    const decl = firstDecl(`
      Database: Postgres -> (
        Table: Users -> (
          Array<String>: Tags
        )
      )
    `);
    if (decl.kind !== "DatabaseDecl") throw new Error("type guard");
    const col = decl.tables[0]!.columns[0]!;
    expect(col.type.name.name).toBe("Array");
    expect(col.type.generics).toHaveLength(1);
    expect(col.type.generics[0]!.name.name).toBe("String");
  });
});
