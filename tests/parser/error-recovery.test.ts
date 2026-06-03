import { describe, it, expect } from "vitest";
import { parse } from "./helpers.js";

describe("Error recovery", () => {
  it("records a diagnostic for an unclosed paren but still returns an AST", () => {
    const { ast, diagnostics } = parse(`Number: X <- (1 + 2`);
    expect(ast.kind).toBe("File");
    expect(diagnostics.length).toBeGreaterThan(0);
  });

  it("continues parsing later declarations after an early error", () => {
    // The first line is malformed at top level (`!!! ;;;` is junk),
    // but the parser must still pick up the second well-formed
    // declaration after panic-mode synchronisation.
    const { ast, diagnostics } = parse(`
      !!! ;;;
      Number: Y <- 2
    `);
    expect(diagnostics.length).toBeGreaterThan(0);
    const yDecl = ast.declarations.find(
      (d) => (d as { name?: { name: string } }).name?.name === "Y",
    );
    expect(yDecl).toBeDefined();
  });

  it("uses unique diagnostic codes (MOD-Pxxx)", () => {
    const { diagnostics } = parse(`Number: X <- (1 + 2`);
    const codes = (diagnostics as { code: string }[]).map((d) => d.code);
    for (const c of codes) {
      expect(c).toMatch(/^MOD-P/);
    }
  });

  it("never throws when given completely junk input", () => {
    expect(() => parse(`!!! @@@ <<<< >>> ::: ---`)).not.toThrow();
  });

  it("synchronises to the next top-level decl after a stray junk", () => {
    const { ast } = parse(`
      ??? !!!
      Number: X <- 0
    `);
    const named = ast.declarations.find(
      (d) => "name" in d && (d as { name?: { name: string } }).name?.name === "X",
    );
    expect(named).toBeDefined();
  });

  it("clean source produces zero diagnostics", () => {
    const { diagnostics } = parse(`Number: X <- 0`);
    expect(diagnostics).toHaveLength(0);
  });
});
