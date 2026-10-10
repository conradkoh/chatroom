/**
 * Remove ANSI escape sequences and control characters from untrusted text
 * before writing to the terminal, including Unicode bidi embedding/override/isolate
 * controls (Trojan Source); U+2028/U+2029 become newlines.
 *
 * LRM, RLM, ALM and ZWJ are kept so right-to-left and emoji text still renders.
 */
export function sanitizeForTerminal(input: string): string {
  return input
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u202A-\u202E\u2066-\u2069]/g, '')
    .replace(/[\u2028\u2029]/g, '\n');
}

export function sanitizeUnknownForTerminal(value: unknown): string {
  if (typeof value === 'string') {
    return sanitizeForTerminal(value);
  }
  return sanitizeForTerminal(String(value));
}
