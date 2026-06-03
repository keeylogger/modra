/**
 * Pratt expression-operator precedence table.
 *
 * Binding powers are integers. For a left-associative operator, the
 * right-binding-power passed to the recursive call is `bp`. For a
 * right-associative operator, it's `bp - 1`. The Pratt loop continues
 * as long as the *next* operator's left-binding-power exceeds the
 * caller's threshold.
 *
 * Levels (low to high):
 *  1  or, ||
 *  2  xor
 *  3  and, &&
 *  4  not / !       (prefix only)
 *  5  ==, !=, is, is not
 *  6  <, <=, >, >=, contains, matches, between, within, outside, in, notIn
 *  7  | (pipe)
 *  8  + - (binary)
 *  9  * / %
 *  10 unary - +
 *  11 . [] ()       (postfix; handled inline by the Pratt loop, not via bp)
 *
 * Operators not listed here (notably `<-`, `->`, `<:`, `::`, `<->`) are
 * statement-level and are recognised by the statement parser, never by
 * the Pratt loop.
 */

import { TokenType, type Token } from "../lexer/tokens.js";
import type { BinaryOperator } from "../ast/nodes.js";

export type Associativity = "left" | "right";

export interface InfixInfo {
  bp: number;
  assoc: Associativity;
  operator: BinaryOperator;
}

export interface PrefixInfo {
  bp: number;
  operator: "-" | "+" | "!" | "not";
}

/**
 * Return infix binding info for the given token, or null if the token
 * is not a Modra expression-level infix operator. Some tokens (e.g.
 * `is`) require multi-token disambiguation; the caller (Pratt parser)
 * handles those by peeking ahead and matching the keyword pair.
 */
export function infixInfo(tok: Token): InfixInfo | null {
  switch (tok.type) {
    case TokenType.LogicalOr:
      return { bp: 10, assoc: "left", operator: "||" };
    case TokenType.LogicalAnd:
      return { bp: 30, assoc: "left", operator: "&&" };
    case TokenType.EqualsEquals:
      return { bp: 50, assoc: "left", operator: "==" };
    case TokenType.BangEquals:
      return { bp: 50, assoc: "left", operator: "!=" };
    case TokenType.LessThan:
      return { bp: 60, assoc: "left", operator: "<" };
    case TokenType.LessEqual:
      return { bp: 60, assoc: "left", operator: "<=" };
    case TokenType.GreaterThan:
      return { bp: 60, assoc: "left", operator: ">" };
    case TokenType.GreaterEqual:
      return { bp: 60, assoc: "left", operator: ">=" };
    case TokenType.Pipe:
      return { bp: 70, assoc: "left", operator: "|" };
    case TokenType.Plus:
      return { bp: 80, assoc: "left", operator: "+" };
    case TokenType.Minus:
      return { bp: 80, assoc: "left", operator: "-" };
    case TokenType.Star:
      return { bp: 90, assoc: "left", operator: "*" };
    case TokenType.Slash:
      return { bp: 90, assoc: "left", operator: "/" };
    case TokenType.Percent:
      return { bp: 90, assoc: "left", operator: "%" };
    default:
      return null;
  }
}

/**
 * Infix info for English-keyword operators (`and`, `or`, `xor`, `is`,
 * `is not`, `in`, `notIn`, `contains`, `matches`, `between`, `within`,
 * `outside`). The Pratt parser consults this only when the current
 * token is a Keyword with one of these names; multi-token forms (`is
 * not`) are decoded by peeking one further token.
 */
export function keywordInfixInfo(name: string): InfixInfo | null {
  switch (name) {
    case "or":
      return { bp: 10, assoc: "left", operator: "or" };
    case "xor":
      return { bp: 20, assoc: "left", operator: "xor" };
    case "and":
      return { bp: 30, assoc: "left", operator: "and" };
    case "is":
      return { bp: 50, assoc: "left", operator: "is" };
    case "in":
      return { bp: 60, assoc: "left", operator: "in" };
    case "notIn":
      return { bp: 60, assoc: "left", operator: "notIn" };
    case "contains":
      return { bp: 60, assoc: "left", operator: "contains" };
    case "matches":
      return { bp: 60, assoc: "left", operator: "matches" };
    case "between":
      return { bp: 60, assoc: "left", operator: "between" };
    case "within":
      return { bp: 60, assoc: "left", operator: "within" };
    case "outside":
      return { bp: 60, assoc: "left", operator: "outside" };
    default:
      return null;
  }
}

/** Symbolic prefix operators (`-`, `+`, `!`). */
export function prefixInfo(tok: Token): PrefixInfo | null {
  switch (tok.type) {
    case TokenType.Minus:
      return { bp: 100, operator: "-" };
    case TokenType.Plus:
      return { bp: 100, operator: "+" };
    case TokenType.Bang:
      return { bp: 100, operator: "!" };
    default:
      return null;
  }
}

/** `not` is the English prefix alias for `!`. */
export const NOT_PREFIX_BP = 40;
