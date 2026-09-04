/**
 * Canonical template repository identity for fork/upstream checks.
 */
export const TEMPLATE_REPO_URL = 'https://github.com/conradkoh/next-convex-starter-app';
export const TEMPLATE_OWNER_REPO = 'conradkoh/next-convex-starter-app';

export type GitHubOwnerRepo = {
  owner: string;
  repo: string;
};

function parseScpGitHubUrl(value: string): GitHubOwnerRepo | null {
  const scpMatch = value.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!scpMatch) {
    return null;
  }
  return { owner: scpMatch[1], repo: scpMatch[2] };
}

function isAllowedGitHubUrl(url: URL): boolean {
  const isHttpsOrSsh = url.protocol === 'https:' || url.protocol === 'ssh:';
  const isGitHubHost = url.hostname.toLowerCase() === 'github.com';
  return isHttpsOrSsh && isGitHubHost;
}

function ownerRepoFromPath(pathname: string): GitHubOwnerRepo | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 2) {
    return null;
  }
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, '') };
}

function parseUrlGitHubOwnerRepo(value: string): GitHubOwnerRepo | null {
  try {
    const url = new URL(value);
    if (!isAllowedGitHubUrl(url)) {
      return null;
    }
    return ownerRepoFromPath(url.pathname);
  } catch {
    return null;
  }
}

/**
 * Parse owner/repo from a GitHub URL.
 * Supports:
 *   https://github.com/owner/repo[.git]
 *   git@github.com:owner/repo[.git]      (SCP-style SSH)
 *   ssh://git@github.com/owner/repo[.git]
 * Rejects lookalike hosts, non-URL strings, and URLs with extra path segments.
 */
export function parseGitHubOwnerRepo(repoUrl: string): GitHubOwnerRepo | null {
  const value = repoUrl.trim();
  return parseScpGitHubUrl(value) ?? parseUrlGitHubOwnerRepo(value);
}

function normalizeOwnerRepo(remoteUrl: string | null | undefined): string | null {
  if (!remoteUrl) {
    return null;
  }

  const parsed = parseGitHubOwnerRepo(remoteUrl.trim());
  if (!parsed) {
    return null;
  }

  return `${parsed.owner}/${parsed.repo}`;
}

export function isTemplateRemote(remoteUrl: string | null | undefined): boolean {
  return normalizeOwnerRepo(remoteUrl) === TEMPLATE_OWNER_REPO;
}
