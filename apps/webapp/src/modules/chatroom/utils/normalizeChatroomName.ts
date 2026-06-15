import { getWorkspaceDisplayName } from '@/lib/workspaceIdentifier';

/**
 * Strip directory prefixes from a pasted path so "/Users/foo/my-project" → "my-project".
 * Thin, intention-revealing wrapper over the canonical `getWorkspaceDisplayName`
 * basename helper. Falls back to the trimmed input when the basename is empty
 * (e.g. a pasted root path like "/").
 */
export function normalizePastedChatroomName(raw: string): string {
  const trimmed = raw.trim();
  return getWorkspaceDisplayName(trimmed) || trimmed;
}
