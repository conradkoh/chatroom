/**
 * Canonical template repository identity for fork/upstream checks.
 */
export const TEMPLATE_REPO_URL = 'https://github.com/conradkoh/next-convex-starter-app';
export const TEMPLATE_OWNER_REPO = 'conradkoh/next-convex-starter-app';

export type GitHubOwnerRepo = {
  owner: string;
  repo: string;
};

/**
 * Parse owner/repo from a GitHub URL.
 * Supports:
 *   https://github.com/owner/repo
 *   https://github.com/owner/repo.git
 *   git@github.com:owner/repo.git
 */
export function parseGitHubOwnerRepo(repoUrl: string): GitHubOwnerRepo | null {
  const httpsMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?(?:\/.*)?$/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  return null;
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
