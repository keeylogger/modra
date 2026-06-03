/**
 * Source-file primitives used throughout the compiler pipeline.
 *
 * Modra normalises CRLF and lone-CR to LF internally so the rest of the
 * compiler can assume single-byte line breaks. The original source string
 * is preserved on `SourceFile.originalText` and individual token lexemes
 * preserve the bytes they came from.
 */

export interface SourcePosition {
  /** 1-indexed line number (after CR/CRLF normalisation). */
  line: number;
  /** 1-indexed column number (after CR/CRLF normalisation). */
  column: number;
  /** 0-indexed character offset into the normalised source. */
  offset: number;
}

export interface SourceSpan {
  start: SourcePosition;
  end: SourcePosition;
}

export class SourceFile {
  readonly path: string;
  readonly originalText: string;
  readonly normalisedText: string;
  /**
   * Map from normalised offset back to original offset. Used by tooling that
   * needs to surface exact byte positions in the user's on-disk file.
   */
  readonly originalOffsetByNormalisedOffset: Uint32Array;

  constructor(path: string, originalText: string) {
    this.path = path;
    this.originalText = originalText;
    const { normalised, originalOffsets } = normaliseLineEndings(originalText);
    this.normalisedText = normalised;
    this.originalOffsetByNormalisedOffset = originalOffsets;
  }

  /** Convenience: build a SourcePosition at the given offset. */
  positionAt(offset: number): SourcePosition {
    const clamped = Math.max(0, Math.min(offset, this.normalisedText.length));
    let line = 1;
    let column = 1;
    for (let i = 0; i < clamped; i++) {
      if (this.normalisedText.charCodeAt(i) === 0x0a) {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    return { line, column, offset: clamped };
  }
}

/**
 * Normalise `\r\n` and lone `\r` to `\n`. Returns the normalised string and a
 * parallel Uint32Array mapping each normalised offset back to its original
 * byte offset. The mapping has length `normalised.length + 1` so callers can
 * always look up `end` positions safely.
 */
export function normaliseLineEndings(text: string): {
  normalised: string;
  originalOffsets: Uint32Array;
} {
  const out: string[] = [];
  const offsets: number[] = [];
  let i = 0;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code === 0x0d) {
      // CR or CRLF
      offsets.push(i);
      out.push("\n");
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 0x0a) {
        i += 2;
      } else {
        i += 1;
      }
    } else {
      offsets.push(i);
      out.push(text[i]!);
      i += 1;
    }
  }
  offsets.push(i);
  return {
    normalised: out.join(""),
    originalOffsets: new Uint32Array(offsets),
  };
}

/** Format a SourceSpan for human-friendly diagnostic output. */
export function formatSpan(file: string, span: SourceSpan): string {
  return `${file}:${span.start.line}:${span.start.column}`;
}
