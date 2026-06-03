import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parser/index.js";
import { analyze } from "../../src/semantic/index.js";

function load(name: string): string {
  return readFileSync(
    resolve(__dirname, `../lexer/fixtures/${name}`),
    "utf8",
  );
}

function semanticDiagnostics(file: string) {
  const source = load(file);
  const parser = new Parser(source, file);
  const { ast } = parser.parseFile();
  return analyze(ast, file);
}

describe("semantic analysis of fixtures", () => {
  it("storefront.modra: no semantic errors and reactive graph builds", () => {
    const r = semanticDiagnostics("storefront.modra");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    expect(r.fileScope.lookupLocal("CartCount")!.reactive).toBe(true);
  });

  it("register-user.modra: no semantic errors and roles are classified", () => {
    const r = semanticDiagnostics("register-user.modra");
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    // Endpoints are server; Actions / Components are intrinsically
    // client even when the file declares `@@target: Server`. Tables
    // are server (Database scope).
    expect(r.fileScope.lookupLocal("RegisterUser")!.target).toBe("server");
    expect(r.fileScope.lookupLocal("SubmitRegistration")!.target).toBe("client");
    expect(r.fileScope.lookupLocal("RegistrationForm")!.target).toBe("client");
    expect(r.fileScope.lookupLocal("Users")!.target).toBe("server");
  });
});
