import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Parser } from "../../src/parser/index.js";
import { analyze } from "../../src/semantic/index.js";
import { emitProject } from "../../src/emit/index.js";

function emitFromFixture(name: string) {
  const source = readFileSync(
    resolve(__dirname, `../lexer/fixtures/${name}`),
    "utf8",
  );
  const parser = new Parser(source, name);
  const { ast } = parser.parseFile();
  const analysis = analyze(ast, name);
  return emitProject(analysis);
}

describe("end-to-end fixtures → project", () => {
  it("storefront.modra emits a complete React project", () => {
    const e = emitFromFixture("storefront.modra");
    expect(e.files.length).toBeGreaterThanOrEqual(10);
    // CartCount must end up reactive in App.tsx
    const app = e.files.find((f) => f.path === "src/App.tsx")!;
    expect(app.contents).toContain("useState<number>(0)");
    expect(app.contents).toContain("CartCount");
  });

  it("register-user.modra emits client + server + sql + bridge", () => {
    const e = emitFromFixture("register-user.modra");
    const paths = new Set(e.files.map((f) => f.path));
    expect(paths.has("src/components/RegistrationForm.tsx")).toBe(true);
    expect(paths.has("server/routes/RegisterUser.ts")).toBe(true);
    expect(paths.has("db/schema.sql")).toBe(true);
    expect(paths.has("shared/rpc.ts")).toBe(true);
    expect(paths.has("server/native/python.ts")).toBe(true);
  });
});
