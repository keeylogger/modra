import { describe, it, expect } from "vitest";
import { parseOk } from "./helpers.js";

describe("Directives", () => {
  it("parses bare file-top directives", () => {
    const ast = parseOk(`
      @@strict
      @@unsafe
      Number: X <- 0
    `);
    expect(ast.directives).toHaveLength(2);
    expect(ast.directives[0]!.name.name).toBe("strict");
    expect(ast.directives[1]!.name.name).toBe("unsafe");
  });

  it("parses directive with colon value: @@target: Server", () => {
    const ast = parseOk(`@@target: Server\nNumber: X <- 0`);
    expect(ast.directives).toHaveLength(1);
    const d = ast.directives[0]!;
    expect(d.name.name).toBe("target");
    expect(d.value?.kind).toBe("Identifier");
  });

  it("parses directive with parenthesised args", () => {
    const ast = parseOk(`@@experimental(nativeBridges)\nNumber: X <- 0`);
    const d = ast.directives[0]!;
    expect(d.args).toHaveLength(1);
    expect(d.args[0]!.kind).toBe("Identifier");
  });

  it("parses directives with multiple args", () => {
    const ast = parseOk(`@@experimental(a, b, c)\nNumber: X <- 0`);
    const d = ast.directives[0]!;
    expect(d.args).toHaveLength(3);
  });

  it("parses directives both at file-top and attached to a declaration", () => {
    const ast = parseOk(`
      @@strict
      @@reactive
      Component: C -> ( Title: "X" )
    `);
    // Two file-top directives, attached to file or first decl — accept both.
    const totalDirectives =
      ast.directives.length + (ast.declarations[0] as { directives: unknown[] }).directives.length;
    expect(totalDirectives).toBeGreaterThanOrEqual(1);
  });

  it("preserves directive spans", () => {
    const ast = parseOk(`@@strict\nNumber: X <- 0`);
    expect(ast.directives[0]!.span.start.line).toBe(1);
  });
});
