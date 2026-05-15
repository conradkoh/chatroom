/**
 * Utilities for parsing GitHub remote URLs in the webapp.
 *
 * Mirrors the `parseRepoSlug` logic from the CLI git-reader
 * (packages/cli/src/infrastructure/git/git-reader.ts).
 */

/**
 * Extracts the `owner/repo` slug from a GitHub remote URL.
 *
 * Supports:
 * - HTTPS: `https://github.com/owner/repo.git` or `https://github.com/owner/repo`
 * - SSH: `git@github.com:owner/repo.git` or `git@github.com:owner/repo`
 *
 * Returns `null` if the URL cannot be parsed (non-GitHub remotes, etc.).
 */
export function parseRepoSlug(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim();

  // HTTPS format
  const httpsMatch = trimmed.match(/https?:\/\/[^/]+\/([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (httpsMatch && httpsMatch[1] && httpsMatch[2]) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  // SSH format
  const sshMatch = trimmed.match(/git@[^:]+:([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (sshMatch && sshMatch[1] && sshMatch[2]) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  return null;
}
