#!/usr/bin/env node
/**
 * Modra CLI — Phase 1.
 *
 * Only `lex <file>` is fully implemented; `init`, `build`, and `dev`
 * print a polite "coming in a future phase" stub. The CLI is wired
 * through commander so adding the future commands is a one-line edit.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import { Scanner } from "./lexer/scanner.js";
import { describeTokenType, type Token } from "./lexer/tokens.js";
import { formatDiagnostic, type Diagnostic } from "./utils/diagnostics.js";
import { formatPrettyDiagnostic } from "./utils/pretty-diagnostics.js";
import { Parser } from "./parser/index.js";
import { astToJson, walk } from "./ast/index.js";
import { analyze } from "./semantic/index.js";
import { describeType } from "./semantic/types.js";
import { emitProject } from "./emit/index.js";

const VERSION = "1.0.0";

/** Render diagnostics through the pretty formatter when possible. */
function reportDiagnostics(diags: readonly Diagnostic[], file: string, source: string): void {
  if (diags.length === 0) return;
  const color = !!process.stdout.isTTY;
  const sources = new Map<string, string>([[file, source]]);
  console.error("");
  for (const d of diags) {
    try {
      console.error(formatPrettyDiagnostic(d, { sources, color }));
      console.error("");
    } catch {
      console.error("  " + formatDiagnostic(d));
    }
  }
}

const program = new Command();
program
  .name("modra")
  .description("The declarative full-stack language that reads like a flowchart.")
  .version(VERSION);

program
  .command("init")
  .description("Scaffold a new Modra project (hello-world .modra + package.json)")
  .argument("[dir]", "Target directory", ".")
  .option("--name <name>", "Project name", "modra-app")
  .action((dir: string, opts: { name: string }) => {
    const target = resolve(process.cwd(), dir);
    mkdirSync(target, { recursive: true });
    const stem = opts.name;
    const src = join(target, `${stem}.modra`);
    if (existsSync(src)) {
      console.error(`Refusing to overwrite ${src}`);
      process.exit(1);
    }
    writeFileSync(src, defaultStarterModra(stem), "utf8");
    console.log(`Created ${src}`);
    console.log(`Next: \`modra build ${stem}.modra\` to generate the React + Node project.`);
  });

function defaultStarterModra(name: string): string {
  return `@@strict

Database: Postgres -> (
  Table: ${capitalize(name)} -> (
    String: ID @Primary
    String: Title
    Number: Score
    DateTime: CreatedAt <- Now()
  )
)

Endpoint: ListAll(): Array<Object> -> (
  Record: rows <- DB.${capitalize(name)}.Select()
  Return: rows
)

Number: Counter <- 0
Text: Status <- "Counter is {Counter}"

Action: Increment -> (
  Counter <- Counter + 1
)

Component: App -> (
  Window: Root -> (
    Title: "Hello, Modra!"
    Text: Status
    form (
      Submit  label: "Tap"  Click -> Increment
    )
  )
)
`;
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

program
  .command("build")
  .description("Compile a .modra file into a runnable React + Node + Postgres project")
  .argument("<file>", "Path to the .modra source file")
  .option("--out <dir>", "Output directory", "./build")
  .option("--quiet", "Suppress the per-file emission log")
  .action((file: string, opts: { out: string; quiet?: boolean }) => {
    const path = resolve(process.cwd(), file);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch (err) {
      console.error(`Error: could not read ${path}`);
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
    const parser = new Parser(source, path);
    const { ast, diagnostics: parseDiag } = parser.parseFile();
    const analysis = analyze(ast, path);
    const allDiag = [...parseDiag, ...analysis.diagnostics];
    const errors = allDiag.filter((d) => d.severity === "error");
    if (errors.length > 0) {
      console.error("Build failed — semantic errors:");
      reportDiagnostics(errors, path, source);
      process.exit(1);
    }
    const { files } = emitProject(analysis);
    const outDir = resolve(process.cwd(), opts.out);
    mkdirSync(outDir, { recursive: true });
    for (const f of files) {
      const target = resolve(outDir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.contents, "utf8");
      if (!opts.quiet) console.log(`  wrote ${f.path}`);
    }
    console.log("");
    console.log(`Build complete. ${files.length} files written to ${outDir}`);
    console.log("Next: cd into the output dir, run \`npm install\`, then \`npm run dev:server\` & \`npm run dev:client\`.");
  });

program
  .command("dev")
  .description("Rebuild on every save (chokidar-free polling watcher)")
  .argument("<file>", "Path to the .modra source file")
  .option("--out <dir>", "Output directory", "./build")
  .action(async (file: string, opts: { out: string }) => {
    const path = resolve(process.cwd(), file);
    const out = resolve(process.cwd(), opts.out);
    console.log(`Watching ${path} → ${out}`);
    runBuildOnce(path, out);
    let last = 0;
    setInterval(() => {
      try {
        const stat = statSync(path).mtimeMs;
        if (stat !== last) {
          last = stat;
          runBuildOnce(path, out);
        }
      } catch (e) {
        console.error("watcher error:", e);
      }
    }, 500);
  });

function runBuildOnce(path: string, out: string): void {
  try {
    const source = readFileSync(path, "utf8");
    const parser = new Parser(source, path);
    const { ast, diagnostics: parseDiag } = parser.parseFile();
    const analysis = analyze(ast, path);
    const allDiag = [...parseDiag, ...analysis.diagnostics];
    if (allDiag.some((d) => d.severity === "error")) {
      reportDiagnostics(allDiag, path, source);
      console.log("Build skipped — fix errors above and save.");
      return;
    }
    const { files } = emitProject(analysis);
    mkdirSync(out, { recursive: true });
    for (const f of files) {
      const target = resolve(out, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.contents, "utf8");
    }
    console.log(`[${new Date().toLocaleTimeString()}] rebuilt ${files.length} files.`);
  } catch (e) {
    console.error("build failed:", e instanceof Error ? e.message : e);
  }
}

program
  .command("parse")
  .description("Parse a Modra source file and print its AST (debug aid)")
  .argument("<file>", "Path to the .modra source file")
  .option("--json", "Emit JSON (deterministic, prettified) instead of an outline")
  .option("--no-spans", "Omit span information from the output")
  .action((file: string, opts: { json?: boolean; spans?: boolean }) => {
    const path = resolve(process.cwd(), file);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch (err) {
      console.error(`Error: could not read ${path}`);
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
    const parser = new Parser(source, path);
    const { ast, diagnostics } = parser.parseFile();
    const spans = opts.spans !== false;
    if (opts.json) {
      process.stdout.write(astToJson(ast, { spans }));
      process.stdout.write("\n");
    } else {
      printAstOutline(ast);
    }
    if (diagnostics.length > 0) {
      reportDiagnostics(diagnostics, path, source);
      if (diagnostics.some((d) => d.severity === "error")) {
        process.exitCode = 1;
      }
    }
  });

program
  .command("check")
  .description("Parse + semantic-analyze a Modra file; print symbols / types / targets")
  .argument("<file>", "Path to the .modra source file")
  .option("--json", "Emit JSON instead of a human-readable summary")
  .action((file: string, opts: { json?: boolean }) => {
    const path = resolve(process.cwd(), file);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch (err) {
      console.error(`Error: could not read ${path}`);
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
    const parser = new Parser(source, path);
    const { ast, diagnostics: parseDiag } = parser.parseFile();
    const result = analyze(ast, path);
    const allDiag = [...parseDiag, ...result.diagnostics.filter((d) => !parseDiag.includes(d))];
    if (opts.json) {
      const summary = {
        file: path,
        symbols: result.fileScope.allSymbols().map((s) => ({
          name: s.name,
          kind: s.kind,
          type: s.type ? describeType(s.type) : null,
          target: s.target,
          reactive: s.reactive,
          references: s.references.length,
        })),
        reactivity: result.reactivity.nodes.map((n) => ({
          symbol: n.symbol.name,
          reads: Array.from(n.reads).map((r) => r.name),
        })),
        diagnostics: allDiag,
      };
      process.stdout.write(JSON.stringify(summary, null, 2));
      process.stdout.write("\n");
    } else {
      printAnalysisSummary(result);
    }
    if (allDiag.length > 0) {
      reportDiagnostics(allDiag, path, source);
      if (allDiag.some((d) => d.severity === "error")) {
        process.exitCode = 1;
      }
    }
  });

program
  .command("lex")
  .description("Print the lexer's token stream for a Modra source file (debug aid)")
  .argument("<file>", "Path to the .modra source file")
  .option("--trivia", "Include whitespace, newlines, and comments in the output")
  .option("--json", "Emit JSON instead of the human-friendly table format")
  .action((file: string, opts: { trivia?: boolean; json?: boolean }) => {
    const path = resolve(process.cwd(), file);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch (err) {
      console.error(`Error: could not read ${path}`);
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(2);
    }
    const scanner = new Scanner(source, path);
    const tokens = scanner.scanAll({ keepTrivia: opts.trivia === true });
    if (opts.json) {
      process.stdout.write(JSON.stringify(tokens, null, 2));
      process.stdout.write("\n");
    } else {
      printTokenTable(tokens);
    }
    const diagnostics = scanner.diagnostics;
    if (diagnostics.length > 0) {
      console.error("");
      console.error("Diagnostics:");
      for (const d of diagnostics) {
        console.error("  " + formatDiagnostic(d));
      }
      if (scanner.diagnostics.some((d) => d.severity === "error")) {
        process.exitCode = 1;
      }
    }
  });

program.parseAsync(process.argv).catch((err) => {
  console.error(err);
  process.exit(1);
});

function printTokenTable(tokens: Token[]): void {
  const header = ["#", "type", "lexeme", "value", "line:col"];
  const rows = tokens.map((t, i) => [
    String(i),
    describeTokenType(t.type),
    truncate(t.lexeme.replace(/\n/g, "\\n").replace(/\t/g, "\\t"), 40),
    truncate(formatValue(t.value), 40),
    `${t.span.start.line}:${t.span.start.column}`,
  ]);
  const widths = header.map((h, c) =>
    Math.max(h.length, ...rows.map((r) => r[c]!.length)),
  );
  const pad = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  console.log(pad(header));
  console.log(pad(widths.map((w) => "─".repeat(w))));
  for (const row of rows) console.log(pad(row));
  console.log("");
  console.log(`Total: ${tokens.length} tokens.`);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function formatValue(v: string | number | boolean | null): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  return String(v);
}

/**
 * Compact human-readable outline of the AST: one indented line per
 * node, showing only `kind` and a short identifier when present.
 */
function printAstOutline(root: import("./ast/index.js").AnyNode): void {
  let count = 0;
  const stack: import("./ast/index.js").AnyNode[] = [];
  walk(root, (node, parent) => {
    while (stack.length > 0 && stack[stack.length - 1] !== parent) stack.pop();
    const indent = "  ".repeat(stack.length);
    const labelBits: string[] = [node.kind];
    const nameLike = pickLabel(node);
    if (nameLike) labelBits.push(`"${nameLike}"`);
    labelBits.push(`@${node.span.start.line}:${node.span.start.column}`);
    console.log(indent + labelBits.join(" "));
    stack.push(node);
    count++;
    return;
  });
  console.log("");
  console.log(`Total: ${count} AST nodes.`);
}

function printAnalysisSummary(result: import("./semantic/index.js").AnalysisResult): void {
  const symbols = result.fileScope.allSymbols();
  console.log(`Symbols (${symbols.length}):`);
  for (const s of symbols) {
    const flags: string[] = [];
    if (s.reactive) flags.push("reactive");
    if (s.meta.builtin) continue;
    flags.push(s.target);
    const t = s.type ? describeType(s.type) : "?";
    console.log(`  ${s.kind.padEnd(11)} ${s.name.padEnd(20)} : ${t}   [${flags.join(", ")}]`);
  }
  if (result.reactivity.nodes.length > 0) {
    console.log("");
    console.log("Reactivity:");
    for (const n of result.reactivity.nodes) {
      const reads = Array.from(n.reads).map((r) => r.name).join(", ") || "—";
      console.log(`  ${n.symbol.name} ← reads(${reads})`);
    }
  }
}

function pickLabel(node: import("./ast/index.js").AnyNode): string | null {
  switch (node.kind) {
    case "Identifier":
      return node.name;
    case "StringLit":
      return truncate(JSON.stringify(node.value), 30);
    case "NumberLit":
      return String(node.value);
    case "BoolLit":
      return String(node.value);
    case "HexColorLit":
      return node.value;
    case "StringChunkPart":
      return truncate(JSON.stringify(node.value), 30);
    case "Binary":
      return node.operator;
    case "Unary":
      return node.operator;
    default:
      return null;
  }
}
