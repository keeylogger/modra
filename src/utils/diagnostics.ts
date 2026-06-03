/**
 * Lightweight diagnostic collector used by Phase 1.
 *
 * The Rust-style pretty formatter (with carets, error codes, and
 * "did you mean?" hints) lands in Phase 6. For now we record enough
 * information to surface useful messages in tests and CLI output.
 */

import type { SourceSpan } from "./source.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export interface Diagnostic {
  severity: DiagnosticSeverity;
  /** Stable error code for tooling (e.g. "MOD-L001"). */
  code: string;
  message: string;
  span: SourceSpan;
  file: string;
  /** Optional human-friendly hint shown after the main message. */
  hint?: string;
}

export class DiagnosticCollector {
  private readonly items: Diagnostic[] = [];

  add(diag: Diagnostic): void {
    this.items.push(diag);
  }

  error(args: Omit<Diagnostic, "severity">): void {
    this.add({ ...args, severity: "error" });
  }

  warn(args: Omit<Diagnostic, "severity">): void {
    this.add({ ...args, severity: "warning" });
  }

  info(args: Omit<Diagnostic, "severity">): void {
    this.add({ ...args, severity: "info" });
  }

  get all(): readonly Diagnostic[] {
    return this.items;
  }

  get errors(): readonly Diagnostic[] {
    return this.items.filter((d) => d.severity === "error");
  }

  get hasErrors(): boolean {
    return this.items.some((d) => d.severity === "error");
  }

  clear(): void {
    this.items.length = 0;
  }
}

/** Format a single diagnostic as a one-line string for terminal output. */
export function formatDiagnostic(d: Diagnostic): string {
  const tag = d.severity.toUpperCase();
  const where = `${d.file}:${d.span.start.line}:${d.span.start.column}`;
  const base = `${tag} [${d.code}] ${where}: ${d.message}`;
  return d.hint ? `${base}\n  hint: ${d.hint}` : base;
}
