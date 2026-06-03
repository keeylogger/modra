import { describe, expect, it } from "vitest";
import { formatPrettyDiagnostic } from "../../src/utils/pretty-diagnostics.js";

const SAMPLE_SOURCE = `Number: Count <- 0
Number: Bad <- "not a number"
`;

describe("pretty diagnostics", () => {
  it("renders a caret pointing at the span", () => {
    const out = formatPrettyDiagnostic(
      {
        severity: "error",
        code: "MOD-S010",
        message: "Type mismatch.",
        file: "x.modra",
        span: {
          start: { line: 2, column: 16, offset: 0 },
          end: { line: 2, column: 30, offset: 0 },
        },
        hint: "try Number(...)",
      },
      { sources: new Map([["x.modra", SAMPLE_SOURCE]]), color: false },
    );
    expect(out).toContain("error[MOD-S010]: Type mismatch.");
    expect(out).toContain("x.modra:2:16");
    expect(out).toContain("Number: Bad");
    expect(out).toContain("^");
    expect(out).toContain("hint: try Number(...)");
  });

  it("renders nicely without source", () => {
    const out = formatPrettyDiagnostic(
      {
        severity: "warning",
        code: "MOD-W001",
        message: "Hmm.",
        file: "y.modra",
        span: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 2, offset: 0 },
        },
      },
      { sources: new Map(), color: false },
    );
    expect(out).toContain("warning[MOD-W001]: Hmm.");
    expect(out).toContain("y.modra:1:1");
  });
});
