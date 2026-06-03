import { describe, expect, it } from "vitest";
import { emit, fileBy, hasFile } from "./helpers.js";

describe("Postgres DDL emitter", () => {
  it("emits CREATE TABLE for every table", () => {
    const e = emit(`
Database: Postgres -> (
  Table: Users -> (
    String: ID @Primary
    String: Email @Unique
    Number: Age
  )
  Table: Posts -> (
    String: ID @Primary
    String: Title
  )
)
`);
    const sql = fileBy(e, "db/schema.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS Users");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS Posts");
    expect(sql).toContain("PRIMARY KEY");
    expect(sql).toContain("UNIQUE");
  });

  it("does NOT emit schema.sql when no Database is declared", () => {
    const e = emit(`Component: A -> ( Text: "a" )`);
    // The file is always emitted (empty backend ok), but contains no tables.
    expect(hasFile(e, "db/schema.sql")).toBe(true);
    const sql = fileBy(e, "db/schema.sql");
    expect(sql).not.toContain("CREATE TABLE");
  });
});
