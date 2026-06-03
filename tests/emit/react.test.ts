import { describe, expect, it } from "vitest";
import { emit, fileBy } from "./helpers.js";

describe("React emitter", () => {
  it("generates useState for reactive state", () => {
    const e = emit(`
Component: Counter -> (
  Number: Count <- 0
  Text: Count
)
`);
    const out = fileBy(e, "src/components/Counter.tsx");
    expect(out).toMatch(/useState<number>\(0\)/);
  });

  it("generates useMemo for derived state", () => {
    const e = emit(`
Number: A <- 5
Number: B <- A + 1
`);
    const out = fileBy(e, "src/App.tsx");
    expect(out).toMatch(/useMemo<number>/);
  });

  it("two-way binding via :: produces value + onChange", () => {
    const e = emit(`
Component: F -> (
  form (
    InputField::Email placeholder: "email"
  )
)
`);
    const out = fileBy(e, "src/components/F.tsx");
    expect(out).toContain("value={Email}");
    expect(out).toContain("setEmail");
  });

  it("emits API wrapper for endpoints", () => {
    const e = emit(`
Endpoint: GetItems() -> (
  Return: 42
)
Component: A -> ( Text: "x" )
`);
    expect(e.files.some((f) => f.path === "src/api/GetItems.ts")).toBe(true);
  });
});
