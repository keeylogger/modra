import { describe, expect, it } from "vitest";
import { describeType } from "../../src/semantic/index.js";
import { check } from "./helpers.js";

describe("type checker", () => {
  it("infers Number for numeric state", () => {
    const r = check(`
Number: Count <- 0
`);
    const sym = r.fileScope.lookupLocal("Count")!;
    expect(describeType(sym.type!)).toBe("Number");
  });

  it("infers String for string literal", () => {
    const r = check(`
String: Name <- "Modra"
`);
    expect(describeType(r.fileScope.lookupLocal("Name")!.type!)).toBe("String");
  });

  it("infers Array<Number> from array literal", () => {
    const r = check(`
Array<Number>: Nums <- [1, 2, 3]
`);
    expect(describeType(r.fileScope.lookupLocal("Nums")!.type!)).toBe(
      "Array<Number>",
    );
  });

  it("resolves Type aliases", () => {
    const r = check(`
Type: Email: String
String: addr <- "a@b.com"
`);
    const sym = r.fileScope.lookupLocal("Email")!;
    expect(describeType(sym.type!)).toBe("String");
  });

  it("models Endpoint as a function", () => {
    const r = check(`
Endpoint: GetUser(id: String): String -> (
  Return: id
)
`);
    const sym = r.fileScope.lookupLocal("GetUser")!;
    expect(describeType(sym.type!)).toBe("(String) -> String");
  });

  it("reports type mismatch on declared init", () => {
    const r = check(`
Number: Count <- "not a number"
`);
    expect(r.diagnostics.some((d) => d.code === "MOD-S010")).toBe(true);
  });
});
