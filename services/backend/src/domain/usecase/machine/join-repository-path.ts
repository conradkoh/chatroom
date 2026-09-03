import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';

/** Join a repository root and folder name, rejecting traversal and separators. */
// All invalid repository-name cases must be rejected before joining paths.
// fallow-ignore-next-line complexity
export function joinRepositoryPath(repositoryRoot: string, repoName: string): string {
  const trimmedRepo = repoName.trim();
  if (
    !trimmedRepo ||
    trimmedRepo.includes('/') ||
    trimmedRepo.includes('\\') ||
    trimmedRepo.includes('..')
  ) {
    throw new Error('Invalid repository name');
  }
  const base = normalizeWorkingDir(repositoryRoot) || '/';
  return `${base}/${trimmedRepo}`;
}

export function toGithubCloneUrl(owner: string, repo: string): string {
  return `https://github.com/${owner}/${repo}.git`;
}
