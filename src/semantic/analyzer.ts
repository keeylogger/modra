/**
 * Phase-3 orchestrator: resolves symbols, infers types, builds the
 * reactivity graph, and tags client / server / shared targets. Returns
 * a single `AnalysisResult` object that emitters consume.
 */

import type { FileNode } from "../ast/index.js";
import { DiagnosticCollector, type Diagnostic } from "../utils/diagnostics.js";
import { ReactivityAnalyzer, type ReactivityGraph } from "./reactivity.js";
import { Resolver, type ResolutionMap } from "./resolver.js";
import type { Scope } from "./symbols.js";
import { TargetingPass, type TargetingResult } from "./targeting.js";
import { TypeChecker } from "./type-checker.js";

export interface AnalysisResult {
  file: FileNode;
  filePath: string;
  fileScope: Scope;
  resolution: ResolutionMap;
  typeChecker: TypeChecker;
  reactivity: ReactivityGraph;
  targeting: TargetingResult;
  diagnostics: readonly Diagnostic[];
  hasErrors: boolean;
}

export interface AnalyzeOptions {
  /** Extra collector — if provided, parser diagnostics already in it
   *  are preserved and the analyzer appends to it. */
  diagnostics?: DiagnosticCollector;
}

export function analyze(
  file: FileNode,
  filePath: string,
  opts: AnalyzeOptions = {},
): AnalysisResult {
  const diag = opts.diagnostics ?? new DiagnosticCollector();
  const resolver = new Resolver(file, diag, filePath);
  const typeChecker = new TypeChecker(file, resolver, diag, filePath);
  const reactivity = new ReactivityAnalyzer(file, resolver).graph;
  const targeting = new TargetingPass(file, resolver).result;
  return {
    file,
    filePath,
    fileScope: resolver.fileScope,
    resolution: resolver.resolution,
    typeChecker,
    reactivity,
    targeting,
    diagnostics: diag.all,
    hasErrors: diag.hasErrors,
  };
}
