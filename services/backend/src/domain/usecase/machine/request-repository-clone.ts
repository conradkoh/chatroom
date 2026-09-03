// The upsert lifecycle intentionally follows the machine preference use case.
// fallow-ignore-file code-duplication
import { parseGitHubOwnerRepo } from '@workspace/shared/domain/github-url';

import { joinRepositoryPath, toGithubCloneUrl } from './join-repository-path';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function requestRepositoryClone(
  ctx: MutationCtx,
  input: { userId: Id<'users'>; machineId: string; githubUrl: string }
): Promise<{
  requestId: Id<'chatroom_repositoryCloneRequests'>;
  cloneUrl: string;
  targetWorkingDir: string;
}> {
  const parsed = parseGitHubOwnerRepo(input.githubUrl);
  if (!parsed) throw new Error('Invalid GitHub repository URL');

  const rootRow = await ctx.db
    .query('chatroom_machineRepositoryRoots')
    .withIndex('by_userId_machineId', (q) =>
      q.eq('userId', input.userId).eq('machineId', input.machineId)
    )
    .unique();
  if (!rootRow?.repositoryRoot) {
    throw new Error('Set a repository root for this machine in Agent Settings first');
  }

  const targetWorkingDir = joinRepositoryPath(rootRow.repositoryRoot, parsed.repo);
  const cloneUrl = toGithubCloneUrl(parsed.owner, parsed.repo);
  const requestId = await ctx.db.insert('chatroom_repositoryCloneRequests', {
    userId: input.userId,
    machineId: input.machineId,
    githubUrl: input.githubUrl.trim(),
    cloneUrl,
    repoName: parsed.repo,
    targetWorkingDir,
    status: 'pending',
    createdAt: Date.now(),
  });

  return { requestId, cloneUrl, targetWorkingDir };
}
