import { describe, it, expect } from "vitest";
import { Scanner } from "../../src/index.js";

/**
 * When `keepTrivia: true`, concatenating every token's `lexeme` must
 * reconstruct the original source byte-for-byte (after CRLF
 * normalisation). This invariant is what makes the future formatter and
 * LSP rename-refactoring viable.
 */
describe("trivia roundtripping", () => {
  it("reconstructs simple source verbatim", () => {
    const src = "a + b\n  c <- 42";
    const toks = new Scanner(src).scanAll({ keepTrivia: true });
    expect(toks.map((t) => t.lexeme).join("")).toBe(src);
  });

  it("reconstructs source with comments and strings", () => {
    const src = "// hi\na <- \"hello\"\n/* block */ b\n";
    const toks = new Scanner(src).scanAll({ keepTrivia: true });
    expect(toks.map((t) => t.lexeme).join("")).toBe(src);
  });

  it("reconstructs source with directives, decorators, and operators", () => {
    const src = "@@strict\n@@target: Server\nString: Email @Unique <- \"x\"\n";
    const toks = new Scanner(src).scanAll({ keepTrivia: true });
    expect(toks.map((t) => t.lexeme).join("")).toBe(src);
  });

  it("reconstructs source with interpolated strings", () => {
    const src = 'Text: Status <- "Cart: {CartCount} items"\n';
    const toks = new Scanner(src).scanAll({ keepTrivia: true });
    expect(toks.map((t) => t.lexeme).join("")).toBe(src);
  });

  it("reconstructs source with @{…} injections", () => {
    const src = "links <- @{facebook, github}\n";
    const toks = new Scanner(src).scanAll({ keepTrivia: true });
    expect(toks.map((t) => t.lexeme).join("")).toBe(src);
  });

  it("reconstructs source with a Native body", () => {
    const src = "Native<Python>(in: x; out: y) {\n  y = x + 1\n}\n";
    const toks = new Scanner(src).scanAll({ keepTrivia: true });
    expect(toks.map((t) => t.lexeme).join("")).toBe(src);
  });

  it("CRLF input round-trips to LF (normalised form)", () => {
    const original = "a\r\nb\r\nc";
    const normalised = "a\nb\nc";
    const toks = new Scanner(original).scanAll({ keepTrivia: true });
    expect(toks.map((t) => t.lexeme).join("")).toBe(normalised);
  });

  it("non-trivia output drops whitespace and comments", () => {
    const src = "a  /*x*/  b";
    const toks = new Scanner(src).scanAll();
    expect(toks.map((t) => t.lexeme).filter((l) => l.length > 0)).toEqual(["a", "b"]);
  });
});
