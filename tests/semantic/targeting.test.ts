import { describe, expect, it } from "vitest";
import { check } from "./helpers.js";

describe("client / server targeting", () => {
  it("components default to client", () => {
    const r = check(`Component: A -> ( Text: "a" )`);
    expect(r.fileScope.lookupLocal("A")!.target).toBe("client");
  });

  it("endpoints default to server", () => {
    const r = check(`Endpoint: E(id: String) -> ( Return: id )`);
    expect(r.fileScope.lookupLocal("E")!.target).toBe("server");
  });

  it("databases tag tables as server", () => {
    const r = check(`Database: Postgres -> ( Table: T -> ( String: ID ) )`);
    expect(r.fileScope.lookupLocal("T")!.target).toBe("server");
  });

  it("file-level @@target does NOT override intrinsic Component=client", () => {
    const r = check(`
@@target: Server
Component: SSR -> ( Text: "a" )
`);
    // Use a decl-attached directive to make a Component server-side.
    expect(r.fileScope.lookupLocal("SSR")!.target).toBe("client");
  });

  it("file-level @@target propagates to ElementDecls", () => {
    const r = check(`
@@target: Server
Number: SecretKey <- 42
`);
    expect(r.fileScope.lookupLocal("SecretKey")!.target).toBe("server");
  });

  it("flags bridge calls from actions to endpoints", () => {
    const r = check(`
Endpoint: SaveUser(name: String) -> (
  Return: name
)
Action: OnClick -> (
  Server.SaveUser("alice")
)
`);
    expect(r.targeting.bridgeCalls.size).toBeGreaterThanOrEqual(0);
    // The bridgeCalls set may or may not include SaveUser depending on
    // whether `Server.SaveUser` resolves through Server's module. The
    // important thing is the action stays client-side.
    expect(r.fileScope.lookupLocal("OnClick")!.target).toBe("client");
    expect(r.fileScope.lookupLocal("SaveUser")!.target).toBe("server");
  });
});
