/**
 * Remove ANSI escape sequences and control characters from untrusted text
 * before writing to the terminal.
 */
export function sanitizeForTerminal(input: string): string {
  return input
    .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
    .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '');
}

export function sanitizeUnknownForTerminal(value: unknown): string {
  if (typeof value === 'string') {
    return sanitizeForTerminal(value);
  }
  return sanitizeForTerminal(String(value));
}
