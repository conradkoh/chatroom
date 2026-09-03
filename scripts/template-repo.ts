/**
 * Canonical template repository identity for fork/upstream checks.
 */
// The root scripts package is not a pnpm workspace package, so use the shared
// source module directly while preserving this module's public re-export.
import { parseGitHubOwnerRepo } from '../packages/shared/src/domain/github-url';

export const TEMPLATE_REPO_URL = 'https://github.com/conradkoh/next-convex-starter-app';
export const TEMPLATE_OWNER_REPO = 'conradkoh/next-convex-starter-app';

export { parseGitHubOwnerRepo };

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
