import { describe, expect, it } from "vitest";
import { emit, fileBy } from "./helpers.js";

describe("auto client-server bridge", () => {
  it("emits shared/rpc.ts with endpoint metadata", () => {
    const e = emit(`
Endpoint: SaveUser(name: String) -> (
  Return: name
)
`);
    const rpc = fileBy(e, "shared/rpc.ts");
    expect(rpc).toContain("SaveUser");
    expect(rpc).toContain("/api/SaveUser");
    expect(rpc).toContain("SaveUserRequest");
    expect(rpc).toContain("SaveUserResponse");
  });

  it("emits shared/types.ts with table row types", () => {
    const e = emit(`
Database: Postgres -> (
  Table: Items -> ( String: ID @Primary; String: Name )
)
`);
    const t = fileBy(e, "shared/types.ts");
    expect(t).toContain("interface Items");
    expect(t).toContain("ID:");
    expect(t).toContain("Name:");
  });

  it("client api wrapper uses fetch with the bridge path", () => {
    const e = emit(`
Endpoint: Greet(name: String) -> (
  Return: name
)
`);
    const w = fileBy(e, "src/api/Greet.ts");
    expect(w).toContain("fetch(\"/api/Greet\"");
    expect(w).toContain("Content-Type");
  });
});
