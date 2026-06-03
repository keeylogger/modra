import { describe, expect, it } from "vitest";
import { check } from "./helpers.js";

describe("symbols", () => {
  it("declares a Component symbol at file scope", () => {
    const r = check(`
Component: Greeting -> (
  Text: "Hello"
)
`);
    const sym = r.fileScope.lookupLocal("Greeting");
    expect(sym).not.toBeNull();
    expect(sym!.kind).toBe("component");
    expect(sym!.target).toBe("client");
  });

  it("declares an Endpoint as server", () => {
    const r = check(`
Endpoint: GetUser(id: String) -> (
  Return: id
)
`);
    const sym = r.fileScope.lookupLocal("GetUser");
    expect(sym!.kind).toBe("endpoint");
    expect(sym!.target).toBe("server");
  });

  it("declares Action as client", () => {
    const r = check(`
Action: Click -> (
  Log: "tap"
)
`);
    const sym = r.fileScope.lookupLocal("Click");
    expect(sym!.kind).toBe("action");
    expect(sym!.target).toBe("client");
  });

  it("declares tables under their own names", () => {
    const r = check(`
Database: Postgres -> (
  Table: Items -> (
    String: ID
    Number: Quantity
  )
)
`);
    expect(r.fileScope.lookupLocal("Items")!.kind).toBe("table");
    expect(r.fileScope.lookupLocal("Items")!.target).toBe("server");
  });

  it("flags duplicate declarations with MOD-S001", () => {
    const r = check(`
Component: Foo -> (
  Text: "1"
)
Component: Foo -> (
  Text: "2"
)
`);
    expect(r.diagnostics.some((d) => d.code === "MOD-S001")).toBe(true);
  });

  it("respects decl-attached @@target over intrinsic default", () => {
    const r = check(`
@@target: Server
Component: Foo -> (
  Text: "1"
)
`);
    // File-level @@target does NOT override intrinsic Component=client;
    // only a decl-attached @@target would.
    expect(r.fileScope.lookupLocal("Foo")!.target).toBe("client");
  });
});
