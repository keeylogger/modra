import { Parser } from "../../src/parser/index.js";
import { analyze, type AnalysisResult } from "../../src/semantic/index.js";

export function check(source: string, file = "test.modra"): AnalysisResult {
  const parser = new Parser(source, file);
  const { ast, diagnostics } = parser.parseFile();
  const result = analyze(ast, file);
  // Re-inject parser diagnostics so callers can see all of them.
  return {
    ...result,
    diagnostics: [...diagnostics, ...result.diagnostics],
    hasErrors:
      diagnostics.some((d) => d.severity === "error") || result.hasErrors,
  };
}
