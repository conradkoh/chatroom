import { execSync } from 'node:child_process';

import { isTemplateRemote, parseGitHubOwnerRepo } from './template-repo';

export function getOriginRemoteUrl(): string | null {
  try {
    const output = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
    return output || null;
  } catch {
    return null;
  }
}

export function shouldSkipGitHubRepoSetup(
  originUrl: string | null,
  explicitRepoUrl: string | null,
  skipFlag: boolean
): boolean {
  if (skipFlag) return true;
  if (explicitRepoUrl) return false;
  if (!originUrl) return false;
  return !isTemplateRemote(originUrl);
}

export { parseGitHubOwnerRepo };
