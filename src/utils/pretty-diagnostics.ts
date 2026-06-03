/**
 * Pretty diagnostic renderer.
 *
 * Produces Rust-style multi-line output:
 *
 *     error[MOD-S010]: Cannot assign String to Number.
 *      --> src/storefront.modra:12:24
 *       |
 *    12 | Number: Count <- "not a number"
 *       |                  ^^^^^^^^^^^^^^ expected Number, got String
 *       |
 *       = hint: try parsing the string with Number(...)
 *
 * ANSI colour is enabled when stdout is a TTY (or the caller asks).
 */

import type { Diagnostic } from "./diagnostics.js";
import type { SourceSpan } from "./source.js";

export interface PrettyOptions {
  /** Source code keyed by file path. Required for caret rendering. */
  sources: Map<string, string>;
  /** ANSI colours? */
  color?: boolean;
}

export function formatPrettyDiagnostic(
  d: Diagnostic,
  opts: PrettyOptions,
): string {
  const color = opts.color ?? false;
  const source = opts.sources.get(d.file);
  const sev = severityLabel(d.severity, color);
  const code = colorize(`[${d.code}]`, color, "dim");

  const header = `${sev}${code}: ${d.message}`;
  const where = `  ${colorize("-->", color, "blue")} ${d.file}:${d.span.start.line}:${d.span.start.column}`;

  if (!source) {
    let out = `${header}\n${where}`;
    if (d.hint) out += `\n  ${colorize("= hint:", color, "cyan")} ${d.hint}`;
    return out;
  }

  const caret = renderCaret(source, d.span, color);
  let out = `${header}\n${where}\n${caret}`;
  if (d.hint) out += `\n  ${colorize("= hint:", color, "cyan")} ${d.hint}`;
  return out;
}

function severityLabel(s: Diagnostic["severity"], color: boolean): string {
  switch (s) {
    case "error":
      return colorize("error", color, "red") + colorize("", color, "reset");
    case "warning":
      return colorize("warning", color, "yellow");
    case "info":
      return colorize("info", color, "blue");
  }
}

function renderCaret(source: string, span: SourceSpan, color: boolean): string {
  const lines = source.split(/\r?\n/);
  const lineNo = span.start.line;
  if (lineNo < 1 || lineNo > lines.length) return "";
  const line = lines[lineNo - 1] ?? "";
  const startCol = Math.max(0, span.start.column - 1);
  // Span may cross lines — clamp to current line.
  const endCol =
    span.end.line === span.start.line
      ? Math.max(startCol + 1, span.end.column - 1)
      : line.length;
  const gutter = String(lineNo).padStart(3, " ");
  const pipe = colorize("|", color, "blue");
  const caret =
    " ".repeat(startCol) + colorize("^".repeat(Math.max(1, endCol - startCol)), color, "red");
  const lineDisplay = `${colorize(gutter, color, "blue")} ${pipe} ${line}`;
  const pointer = `    ${pipe} ${caret}`;
  return `    ${pipe}\n${lineDisplay}\n${pointer}\n    ${pipe}`;
}

// ─── ANSI helpers ───────────────────────────────────────────
type Colour = "red" | "yellow" | "blue" | "cyan" | "dim" | "reset";
const CODES: Record<Colour, string> = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

function colorize(s: string, enable: boolean, c: Colour): string {
  if (!enable) return s;
  return CODES[c] + s + CODES.reset;
}
