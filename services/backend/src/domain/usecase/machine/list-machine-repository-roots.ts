import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

/** List repository root preferences keyed by machine ID for one user. */
export async function listMachineRepositoryRoots(
  ctx: QueryCtx,
  userId: Id<'users'>
): Promise<Record<string, string>> {
  const rows = await ctx.db
    .query('chatroom_machineRepositoryRoots')
    .withIndex('by_userId', (q) => q.eq('userId', userId))
    .collect();

  const out: Record<string, string> = {};
  for (const row of rows) out[row.machineId] = row.repositoryRoot;
  return out;
}
