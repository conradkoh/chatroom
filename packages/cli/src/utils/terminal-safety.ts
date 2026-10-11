/**
 * Remove ANSI escape sequences and control characters from untrusted text
 * before writing to the terminal, including Unicode bidi embedding/override/isolate
 * controls (Trojan Source); U+2028/U+2029 become newlines. CR/CRLF become LF.
 * Invisible carriers are stripped (ASCII smuggling): zero-width space, word joiner,
 * BOM, soft hyphen, Hangul fillers (U+115F, U+1160, U+3164, U+FFA0), invisible
 * operators (U+2061–U+2064), Unicode tag characters (U+E0000–U+E007F) and the
 * variation selectors supplement (U+E0100–U+E01EF). ZWNJ, ZWJ and VS16 are kept
 * because they shape text and emoji.
 *
 * LRM, RLM, ALM and ZWJ are kept so right-to-left and emoji text still renders.
 */
export function sanitizeForTerminal(input: string): string {
  return (
    input
      .replace(/\r\n?/g, '\n')
      .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
      .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
      .replace(/[\u2028\u2029]/g, '\n')
      // Invisible carriers for ASCII smuggling. Soft hyphen and the Hangul fillers are
      // invisible in terminal output, so removing them does not change visible text.
      .replace(
        /[\u00ad\u034f\u115f\u1160\u180e\u200b\u2060-\u2064\u3164\ufeff\uffa0]|[\u{E0000}-\u{E007F}]|[\u{E0100}-\u{E01EF}]/gu,
        ''
      )
  );
}

export function sanitizeUnknownForTerminal(value: unknown): string {
  if (typeof value === 'string') {
    return sanitizeForTerminal(value);
  }
  return sanitizeForTerminal(String(value));
}
