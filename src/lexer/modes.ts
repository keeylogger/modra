/**
 * Lexer mode stack.
 *
 * Modra v2 has four lexer modes. Modes are pushed and popped as
 * syntactic landmarks (string delimiters, injection openers, native
 * block openers) are encountered. When an inner mode finishes, the
 * Scanner pops back to *whatever was pushed before it* — which is what
 * gives us correctness for nested cases like `@{ "hello {name}" }` or
 * `"some {if x then "a" else "b"} text"`.
 */

export enum LexerMode {
  /** Default. Standard Modra tokens. */
  Modra = "Modra",
  /** Inside `@{ … }` (expression injection). Brace-depth tracked. */
  Injection = "Injection",
  /** Inside `Native<Lang>(…) { … }` — body is captured verbatim. */
  NativeBody = "NativeBody",
  /** Inside a `"…"` string literal, between chunks/injections. */
  String = "String",
}

export class ModeStack {
  private readonly stack: LexerMode[] = [LexerMode.Modra];

  push(mode: LexerMode): void {
    this.stack.push(mode);
  }

  pop(): LexerMode {
    if (this.stack.length === 1) {
      // We never pop the root Modra mode. Defensive: return current.
      return this.stack[0]!;
    }
    return this.stack.pop()!;
  }

  get current(): LexerMode {
    return this.stack[this.stack.length - 1]!;
  }

  get depth(): number {
    return this.stack.length;
  }

  /** True if any frame in the stack matches `mode`. */
  containsMode(mode: LexerMode): boolean {
    return this.stack.includes(mode);
  }
}
