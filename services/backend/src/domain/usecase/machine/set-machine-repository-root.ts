import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeWorkingDir } from '../../../../convex/workspacePathSecurity';

/**
 * Persist or clear one user's repository root preference for an owned machine.
 * Empty values delete the preference so callers never store an empty path.
 */
// fallow-ignore-next-line complexity
export async function setMachineRepositoryRoot(
  ctx: MutationCtx,
  input: {
    userId: Id<'users'>;
    machineId: string;
    repositoryRoot: string | undefined;
  }
): Promise<void> {
  const existing = await ctx.db
    .query('chatroom_machineRepositoryRoots')
    .withIndex('by_userId_machineId', (q) =>
      q.eq('userId', input.userId).eq('machineId', input.machineId)
    )
    .unique();

  if (!input.repositoryRoot?.trim()) {
    if (existing) await ctx.db.delete('chatroom_machineRepositoryRoots', existing._id);
    return;
  }

  // normalizeWorkingDir trims redundant trailing separators; preserve the filesystem root.
  const normalizedRoot = normalizeWorkingDir(input.repositoryRoot);
  const repositoryRoot = normalizedRoot || '/';
  const now = Date.now();
  if (existing) {
    await ctx.db.patch('chatroom_machineRepositoryRoots', existing._id, {
      repositoryRoot,
      updatedAt: now,
    });
  } else {
    await ctx.db.insert('chatroom_machineRepositoryRoots', {
      userId: input.userId,
      machineId: input.machineId,
      repositoryRoot,
      updatedAt: now,
    });
  }
}
