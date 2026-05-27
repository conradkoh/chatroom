/**
 * GitHub URL utilities.
 *
 * Shared helpers for parsing and constructing GitHub URLs from git remote URLs.
 */

/** Derive GitHub repo HTTPS URL from a git remote URL (SSH or HTTPS format). */
export function toGitHubRepoUrl(remoteUrl: string): string | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^git@github\.com:(.+?)(\.git)?$/);
  if (sshMatch) return `https://github.com/${sshMatch[1]}`;
  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/^https:\/\/github\.com\/(.+?)(\.git)?$/);
  if (httpsMatch) return `https://github.com/${httpsMatch[1]}`;
  return null;
}
