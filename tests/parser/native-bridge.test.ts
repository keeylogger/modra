import { describe, it, expect } from "vitest";
import { firstDecl } from "./helpers.js";
import { findFirst } from "../../src/index.js";

describe("Native bridge", () => {
  it("parses an inline Native<Python> bridge with inputs and outputs", () => {
    const decl = firstDecl(`
      Component: C -> (
        Native<Python>(in: a, b; out: result){
          result = a + b
        }
      )
    `);
    const nb = findFirst(decl as never, "NativeBridge");
    expect(nb).not.toBeNull();
    if (!nb) throw new Error("missing NativeBridge");
    expect(nb.language.name).toBe("Python");
    expect(nb.inputs.map((i) => i.name)).toEqual(["a", "b"]);
    expect(nb.outputs.map((o) => o.name)).toEqual(["result"]);
    expect(nb.body).toContain("result");
  });

  it("parses a Native bridge with no inputs", () => {
    const decl = firstDecl(`
      Component: C -> (
        Native<JavaScript>(out: x){
          x = 42
        }
      )
    `);
    const nb = findFirst(decl as never, "NativeBridge");
    if (!nb) throw new Error("missing NativeBridge");
    expect(nb.inputs).toHaveLength(0);
    expect(nb.outputs).toHaveLength(1);
  });

  it("parses a Native bridge with no outputs", () => {
    const decl = firstDecl(`
      Component: C -> (
        Native<Python>(in: x){
          print(x)
        }
      )
    `);
    const nb = findFirst(decl as never, "NativeBridge");
    if (!nb) throw new Error("missing NativeBridge");
    expect(nb.inputs.map((i) => i.name)).toEqual(["x"]);
    expect(nb.outputs).toHaveLength(0);
  });

  it("preserves the body text verbatim (no trimming, no normalising)", () => {
    const decl = firstDecl(
      `Component: C -> ( Native<Python>(out: x){ x   =   "hi" } )`,
    );
    const nb = findFirst(decl as never, "NativeBridge");
    if (!nb) throw new Error("missing NativeBridge");
    expect(nb.body).toContain('"hi"');
  });
});
