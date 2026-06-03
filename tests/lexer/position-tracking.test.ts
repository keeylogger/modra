import { describe, it, expect } from "vitest";
import { Scanner } from "../../src/index.js";

describe("position tracking", () => {
  it("tracks 1-indexed lines and columns", () => {
    const src = "a\n  b\n   c";
    const toks = new Scanner(src).scanAll();
    expect(toks[0]!.span.start).toEqual({ line: 1, column: 1, offset: 0 });
    expect(toks[1]!.span.start).toEqual({ line: 2, column: 3, offset: 4 });
    expect(toks[2]!.span.start).toEqual({ line: 3, column: 4, offset: 9 });
  });

  it("tracks end positions correctly", () => {
    const toks = new Scanner("hello").scanAll();
    expect(toks[0]!.span.start).toEqual({ line: 1, column: 1, offset: 0 });
    expect(toks[0]!.span.end).toEqual({ line: 1, column: 6, offset: 5 });
  });

  it("multi-character operators have correct spans", () => {
    const toks = new Scanner("<->").scanAll();
    expect(toks[0]!.span.start).toEqual({ line: 1, column: 1, offset: 0 });
    expect(toks[0]!.span.end).toEqual({ line: 1, column: 4, offset: 3 });
  });

  it("normalises CRLF to LF for line counting", () => {
    const src = "a\r\nb\r\nc";
    const toks = new Scanner(src).scanAll();
    expect(toks[0]!.span.start.line).toBe(1);
    expect(toks[1]!.span.start.line).toBe(2);
    expect(toks[2]!.span.start.line).toBe(3);
  });

  it("normalises lone CR to LF", () => {
    const src = "a\rb\rc";
    const toks = new Scanner(src).scanAll();
    expect(toks[0]!.span.start.line).toBe(1);
    expect(toks[1]!.span.start.line).toBe(2);
    expect(toks[2]!.span.start.line).toBe(3);
  });

  it("strings track positions across their entire span", () => {
    const toks = new Scanner('"hello world"').scanAll();
    expect(toks[0]!.span.start.column).toBe(1);
    expect(toks[0]!.span.end.column).toBe(14);
  });

  it("token after a newline starts at column 1", () => {
    const toks = new Scanner("\nabc").scanAll();
    expect(toks[0]!.span.start).toEqual({ line: 2, column: 1, offset: 1 });
  });

  it("EOF token's span sits at the final offset", () => {
    const src = "abc";
    const toks = new Scanner(src).scanAll();
    const eof = toks[toks.length - 1]!;
    expect(eof.span.start.offset).toBe(src.length);
  });

  it("file path is propagated to every token", () => {
    const toks = new Scanner("a + b", "/tmp/x.modra").scanAll();
    for (const t of toks) {
      expect(t.file).toBe("/tmp/x.modra");
    }
  });
});
