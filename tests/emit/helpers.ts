import { Parser } from "../../src/parser/index.js";
import { analyze } from "../../src/semantic/index.js";
import { emitProject, type ProjectEmission } from "../../src/emit/index.js";

export function emit(source: string, file = "test.modra"): ProjectEmission {
  const parser = new Parser(source, file);
  const { ast } = parser.parseFile();
  const analysis = analyze(ast, file);
  return emitProject(analysis);
}

export function fileBy(emission: ProjectEmission, path: string): string {
  const f = emission.files.find((x) => x.path === path);
  if (!f) throw new Error(`Expected file ${path} not emitted; got: ${emission.files.map((x) => x.path).join(", ")}`);
  return f.contents;
}

export function hasFile(emission: ProjectEmission, path: string): boolean {
  return emission.files.some((x) => x.path === path);
}
