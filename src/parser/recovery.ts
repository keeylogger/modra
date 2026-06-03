/**
 * Panic-mode error recovery.
 *
 * When the parser encounters an unexpected token, it records a
 * diagnostic and then calls `synchronize(cur)` to skip tokens until
 * the next "safe" boundary (the start of a new statement or
 * declaration). The parser then resumes normal parsing.
 *
 * The set of synchronisation points is conservative: we never skip a
 * top-level structural keyword (Style, Component, Endpoint, etc.) and
 * we always stop at matching `RParen` / `RBrace` / `RBracket` so we
 * don't run off the end of a containing scope.
 */

import { TokenType } from "../lexer/tokens.js";
import type { TokenCursor } from "./parser.js";

const SYNC_KEYWORDS = new Set<string>([
  "Style",
  "Component",
  "Endpoint",
  "Action",
  "Database",
  "Table",
  "Type",
  "Module",
  "Schema",
  "Return",
  "Throw",
  "Yield",
  "Break",
  "Continue",
  "if",
  "while",
  "forEach",
  "loop",
  "repeat",
  "match",
  "attempt",
  "transaction",
  "parallel",
  "sequence",
  "using",
  "return",
  "throw",
  "break",
  "continue",
  "yield",
  "require",
  "assert",
  "expect",
]);

/**
 * Skip tokens until the cursor is positioned at a likely statement /
 * declaration boundary. Stops at:
 *  - end of input
 *  - the first token after a newline (each new line is assumed to
 *    start a fresh statement)
 *  - a close-bracket of any containing scope
 *  - a `@@directive` marker
 *  - any structural / control-flow keyword
 */
export function synchronize(cur: TokenCursor): void {
  while (!cur.isAtEnd()) {
    if (cur.atNewline()) {
      cur.skipNewlines();
      return;
    }
    const tok = cur.peek();
    if (
      tok.type === TokenType.RParen ||
      tok.type === TokenType.RBrace ||
      tok.type === TokenType.RBracket ||
      tok.type === TokenType.DirectiveAt
    ) {
      return;
    }
    if (tok.type === TokenType.Keyword && typeof tok.keyword === "string") {
      if (SYNC_KEYWORDS.has(tok.keyword)) {
        return;
      }
    }
    // Identifier followed by `:` is almost always a decl / element
    // line — stop here so the caller can re-parse.
    if (tok.type === TokenType.Identifier) {
      const next = cur.peek(1);
      if (next.type === TokenType.Colon) return;
    }
    cur.next();
  }
}
