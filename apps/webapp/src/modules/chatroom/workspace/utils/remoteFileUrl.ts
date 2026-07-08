/**
 * Build HTTPS URLs for opening workspace files on a git remote (GitHub-first).
 */

/** Encode each path segment for use in a remote blob/tree URL. */
function encodeRepoFilePath(filePath: string): string {
  return filePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/');
}

/**
 * Build a GitHub-style blob URL for a file on a branch.
 * When `selection` is provided, appends a `:~:text=` fragment for deep-linking.
 */
export function buildRemoteFileUrl(
  repoHttpsUrl: string,
  branch: string,
  filePath: string,
  selection?: string
): string {
  const normalizedRepo = repoHttpsUrl.replace(/\/$/, '');
  const normalizedPath = filePath.replace(/^[/\\]+/, '');
  const base = `${normalizedRepo}/blob/${encodeURIComponent(branch)}/${encodeRepoFilePath(normalizedPath)}`;
  const trimmedSelection = selection?.trim();
  if (!trimmedSelection) return base;
  return `${base}#:~:text=${encodeURIComponent(trimmedSelection)}`;
}
