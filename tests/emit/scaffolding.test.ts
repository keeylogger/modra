import { describe, expect, it } from "vitest";
import { emit, hasFile } from "./helpers.js";

describe("project scaffolding", () => {
  it("emits package.json, vite.config, tsconfig, index.html", () => {
    const e = emit(`Component: Hello -> ( Text: "hi" )`);
    expect(hasFile(e, "package.json")).toBe(true);
    expect(hasFile(e, "vite.config.ts")).toBe(true);
    expect(hasFile(e, "tsconfig.json")).toBe(true);
    expect(hasFile(e, "index.html")).toBe(true);
    expect(hasFile(e, "src/main.tsx")).toBe(true);
    expect(hasFile(e, "src/App.tsx")).toBe(true);
  });

  it("emits one component file per ComponentDecl", () => {
    const e = emit(`
Component: Greeting -> ( Text: "hello" )
Component: Goodbye -> ( Text: "bye" )
`);
    expect(hasFile(e, "src/components/Greeting.tsx")).toBe(true);
    expect(hasFile(e, "src/components/Goodbye.tsx")).toBe(true);
  });

  it("emits an .env.example with DATABASE_URL", () => {
    const e = emit(`Component: A -> ( Text: "a" )`);
    const env = e.files.find((f) => f.path === ".env.example")!;
    expect(env.contents).toContain("DATABASE_URL");
  });
});
