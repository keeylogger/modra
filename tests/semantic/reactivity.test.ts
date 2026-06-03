import { describe, expect, it } from "vitest";
import { check } from "./helpers.js";

describe("reactivity graph", () => {
  it("marks state declarations as reactive", () => {
    const r = check(`
Number: Count <- 0
`);
    expect(r.fileScope.lookupLocal("Count")!.reactive).toBe(true);
  });

  it("tracks dependencies of derived state", () => {
    const r = check(`
Number: A <- 1
Number: B <- A + 2
`);
    const aDeps = r.reactivity.dependents.get(r.fileScope.lookupLocal("A")!);
    expect(aDeps).toBeDefined();
    expect(
      Array.from(aDeps!).some((s) => s.name === "B"),
    ).toBe(true);
  });

  it("records reactive assignments as writes", () => {
    const r = check(`
Number: Count <- 0
Action: Inc -> (
  Count <- Count + 1
)
`);
    expect(r.reactivity.writes.length).toBeGreaterThan(0);
    expect(
      r.reactivity.writes.some((w) => w.symbol.name === "Count"),
    ).toBe(true);
  });
});
