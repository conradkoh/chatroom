/**
 * Remove ANSI escape sequences and control characters from untrusted text
 * before writing to the terminal.
 *
 * Rule, applied in order:
 * - CR/CRLF become LF.
 * - OSC and CSI sequences are removed.
 * - C0 and C1 control characters are removed.
 * - U+2028/U+2029 become LF.
 * - Every Default_Ignorable_Code_Point, plus U+FFF9–U+FFFB, is removed, except the six
 *   text-shaping marks: ALM (U+061C), ZWNJ (U+200C), ZWJ (U+200D), LRM (U+200E),
 *   RLM (U+200F) and VS16 (U+FE0F).
 * - Runs of those kept marks are capped at 2.
 *
 * Default_Ignorable_Code_Point is Unicode's own definition of "invisible unless the
 * renderer handles it", so the set stays complete across Unicode versions.
 */

/** Invisible code points to remove: every default-ignorable code point except the kept marks. */
const INVISIBLE =
  /(?![\u061C\u200C-\u200F\uFE0F])[\p{Default_Ignorable_Code_Point}\uFFF9-\uFFFB]/gu;

/**
 * Runs of kept marks longer than 2 are capped at 2. The longest legitimate run is
 * VS16 followed by ZWJ, which is 2 characters.
 */
const KEPT_MARK_RUN = /([\u061C\u200C-\u200F\uFE0F]{2})[\u061C\u200C-\u200F\uFE0F]+/gu;

export function sanitizeForTerminal(input: string): string {
  return (
    input
      .replace(/\r\n?/g, '\n')
      // OSC payload excludes ESC: `[^\u0007]*` would also consume ESC, so a greedy match
      // could run from one OSC sequence through visible text to a later terminator.
      // Excluding ESC stops each match at its own terminator. A stray ESC is still
      // removed by the C0 step below.
      .replace(/\u001B\][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .replace(/[\u2028\u2029]/g, '\n')
      .replace(INVISIBLE, '')
      .replace(KEPT_MARK_RUN, '$1')
  );
}

export function sanitizeUnknownForTerminal(value: unknown): string {
  if (typeof value === 'string') {
    return sanitizeForTerminal(value);
  }
  return sanitizeForTerminal(String(value));
}
