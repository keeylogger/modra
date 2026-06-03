/**
 * Deterministic AST printer.
 *
 * Produces a plain-JSON structure (suitable for JSON.stringify) from
 * any AST node. The output preserves the discriminator `kind` first,
 * compresses spans to a single `L:C-L:C` string, and recursively
 * normalises child nodes. Empty arrays are kept (so consumers can
 * iterate without nullish checks).
 *
 * `astToPlain(node, { spans: false })` strips spans entirely — useful
 * for snapshot tests that don't care about positions.
 */

import type { SourceSpan } from "../utils/source.js";
import type { AnyNode } from "./nodes.js";

export interface PrintOptions {
  /** When false, span fields are omitted from the output. Default: true. */
  spans?: boolean;
}

export function astToPlain(node: AnyNode, opts: PrintOptions = {}): unknown {
  const spans = opts.spans !== false;
  return convert(node, spans);
}

export function astToJson(node: AnyNode, opts: PrintOptions = {}): string {
  return JSON.stringify(astToPlain(node, opts), null, 2);
}

function convert(value: unknown, spans: boolean): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => convert(v, spans));
  }
  if (typeof value !== "object") {
    return value;
  }
  // Node-like (has a string `kind` field). We special-case so the
  // discriminator is the first key in the JSON output.
  const obj = value as Record<string, unknown>;
  if (typeof obj.kind === "string") {
    const out: Record<string, unknown> = { kind: obj.kind };
    for (const key of Object.keys(obj)) {
      if (key === "kind") continue;
      if (key === "span") {
        if (!spans) continue;
        out.span = formatSpan(obj.span as SourceSpan);
        continue;
      }
      out[key] = convert(obj[key], spans);
    }
    return out;
  }
  // Plain object — copy keys in insertion order, recursing into values.
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    out[key] = convert(obj[key], spans);
  }
  return out;
}

function formatSpan(span: SourceSpan): string {
  return `${span.start.line}:${span.start.column}-${span.end.line}:${span.end.column}`;
}
