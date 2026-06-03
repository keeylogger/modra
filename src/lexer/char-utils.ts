/**
 * Character-class predicates shared across the Scanner.
 *
 * Pure functions, no allocations, hot-path safe. ASCII-focused — Modra
 * identifiers are intentionally ASCII-only to keep tooling simple. A
 * future RFC could broaden this to Unicode identifier categories.
 */

export function isDigit(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return c >= 0x30 && c <= 0x39;
}

export function isHexDigit(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return (
    (c >= 0x30 && c <= 0x39) ||
    (c >= 0x41 && c <= 0x46) ||
    (c >= 0x61 && c <= 0x66)
  );
}

export function isAlpha(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
}

export function isAlphaNumeric(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

/**
 * First character of an identifier: letter or underscore. Modra magic
 * globals (`__file__`, etc.) start with underscore, so we allow it here.
 */
export function isIdentStart(ch: string): boolean {
  return isAlpha(ch) || ch === "_";
}

/**
 * Subsequent character of an identifier: letter, digit, or underscore.
 * Note: hyphens are NOT allowed in identifiers — Modra forbids them so
 * `Flex-Between` always lexes as `Flex MINUS Between`.
 */
export function isIdentCont(ch: string): boolean {
  return isAlphaNumeric(ch) || ch === "_";
}

/** True for the ASCII characters that count as horizontal whitespace. */
export function isHorizontalSpace(ch: string): boolean {
  return ch === " " || ch === "\t";
}

/**
 * Uppercase ASCII letter — used by the Scanner to detect identifier
 * convention without consulting the linter.
 */
export function isUpper(ch: string): boolean {
  if (ch.length !== 1) return false;
  const c = ch.charCodeAt(0);
  return c >= 0x41 && c <= 0x5a;
}
