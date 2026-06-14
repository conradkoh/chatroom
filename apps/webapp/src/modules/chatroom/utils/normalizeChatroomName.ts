/** Strip directory prefixes from pasted paths so "/Users/foo/my-project" → "my-project". */
export function normalizePastedChatroomName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.includes('/') && !trimmed.includes('\\')) return trimmed;
  const normalized = trimmed.replace(/[/\\]+$/, '');
  const parts = normalized.split(/[/\\]/);
  const last = parts[parts.length - 1];
  return last?.trim() || trimmed;
}
