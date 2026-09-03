export type GitHubOwnerRepo = {
  owner: string;
  repo: string;
};

function parseScpGitHubUrl(value: string): GitHubOwnerRepo | null {
  const scpMatch = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!scpMatch) return null;
  return { owner: scpMatch[1], repo: scpMatch[2] };
}

function isAllowedGitHubUrl(url: URL): boolean {
  const isHttpsOrSsh = url.protocol === 'https:' || url.protocol === 'ssh:';
  return isHttpsOrSsh && url.hostname.toLowerCase() === 'github.com';
}

function ownerRepoFromPath(pathname: string): GitHubOwnerRepo | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 2) return null;
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
}

function parseUrlGitHubOwnerRepo(value: string): GitHubOwnerRepo | null {
  try {
    const url = new URL(value);
    if (!isAllowedGitHubUrl(url)) return null;
    return ownerRepoFromPath(url.pathname);
  } catch {
    return null;
  }
}

/**
 * Parse owner/repo from a GitHub URL.
 * Supports HTTPS, ssh://, and git@github.com SCP-style SSH forms.
 * Rejects lookalike hosts, non-URL strings, and extra path segments.
 */
export function parseGitHubOwnerRepo(repoUrl: string): GitHubOwnerRepo | null {
  const value = repoUrl.trim();
  return parseScpGitHubUrl(value) ?? parseUrlGitHubOwnerRepo(value);
}
