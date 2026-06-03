import { describe, expect, it } from "vitest";
import { emit, fileBy } from "./helpers.js";

describe("stdlib runtimes", () => {
  it("server runtime exposes DateTime / MathX / HTTP helpers", () => {
    const e = emit(`Endpoint: X() -> ( Return: 1 )`);
    const rt = fileBy(e, "server/runtime.ts");
    expect(rt).toContain("export const DateTime");
    expect(rt).toContain("export const MathX");
    expect(rt).toContain("export async function HttpGet");
    expect(rt).toContain("export async function HttpPost");
    expect(rt).toContain("export const StringX");
  });

  it("client runtime exposes Toast / Navigate / DateTime", () => {
    const e = emit(`Component: A -> ( Text: "a" )`);
    const rt = fileBy(e, "src/runtime.ts");
    expect(rt).toContain("export function Toast");
    expect(rt).toContain("export function Navigate");
    expect(rt).toContain("export const DateTime");
    expect(rt).toContain("export const MathX");
  });
});
