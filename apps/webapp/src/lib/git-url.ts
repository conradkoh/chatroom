/**
 * Git Repository URL utilities.
 *
 * Shared helpers for parsing and constructing HTTPS URLs from git remote URLs.
 * Supports SSH, SSH protocol, HTTPS, and HTTP formats.
 */

/**
 * Convert a git remote URL to HTTPS format.
 *
 * Supports:
 * - SSH: git@host:owner/repo
 * - SSH protocol: ssh://git@host/path
 * - HTTPS: https://host/owner/repo
 * - HTTP: http://host/owner/repo
 *
 * Automatically:
 * - Trims whitespace
 * - Strips .git suffix
 *
 * @param remoteUrl - The git remote URL (SSH, HTTPS, HTTP, etc.)
 * @returns HTTPS URL, or null if format is unrecognized
 */
export function toRepoHttpsUrl(remoteUrl: string): string | null {
  const trimmed = remoteUrl.trim().replace(/\.git$/, '');

  // Direct HTTPS or HTTP URLs
  if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
    return trimmed;
  }

  // SSH format: git@host:owner/repo
  const sshMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    const [, host, path] = sshMatch;
    return `https://${host}/${path}`;
  }

  // SSH protocol format: ssh://git@host/path or ssh://host/path or ssh://host/path
  const sshProtoMatch = trimmed.match(/^ssh:\/\/(?:[^@]+@)?([^/]+)\/(.+)$/);
  if (sshProtoMatch) {
    const [, host, path] = sshProtoMatch;
    return `https://${host}/${path}`;
  }

  return null;
}
