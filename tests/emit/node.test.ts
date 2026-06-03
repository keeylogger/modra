import { describe, expect, it } from "vitest";
import { emit, fileBy } from "./helpers.js";

describe("Node/Express emitter", () => {
  it("creates a route file per endpoint", () => {
    const e = emit(`
Endpoint: Ping(name: String) -> (
  Return: name
)
`);
    const route = fileBy(e, "server/routes/Ping.ts");
    expect(route).toContain("async function Ping(name: string)");
    expect(route).toContain("handlePing");
    expect(route).toContain("req.body");
  });

  it("registers routes in server/index.ts", () => {
    const e = emit(`
Endpoint: Foo() -> ( Return: 1 )
Endpoint: Bar(id: String) -> ( Return: id )
`);
    const idx = fileBy(e, "server/index.ts");
    expect(idx).toContain("handleFoo");
    expect(idx).toContain("handleBar");
    expect(idx).toContain("/api/Foo");
    expect(idx).toContain("/api/Bar");
  });

  it("renders DB helpers when Database is present", () => {
    const e = emit(`
Database: Postgres -> (
  Table: Items -> (
    String: ID @Primary
    String: Name
  )
)
`);
    const db = fileBy(e, "server/db.ts");
    expect(db).toContain("ItemsRow");
    expect(db).toContain("Items: {");
    expect(db).toContain("Insert");
    expect(db).toContain("Select");
  });

  it("emits a runtime module with AuthToken / UUID / Now", () => {
    const e = emit(`Endpoint: X() -> ( Return: 1 )`);
    const rt = fileBy(e, "server/runtime.ts");
    expect(rt).toContain("export function AuthToken");
    expect(rt).toContain("export function UUID");
    expect(rt).toContain("export function Now");
  });

  it("emits a Python native bridge stub when Native<Python> is used", () => {
    const e = emit(`
Endpoint: Hash(pw: String) -> (
  Native<Python>(in: pw; out: hashed) {
    hashed = "fake"
  }
  Return: hashed
)
`);
    const py = fileBy(e, "server/native/python.ts");
    expect(py).toContain("runPython");
  });
});
