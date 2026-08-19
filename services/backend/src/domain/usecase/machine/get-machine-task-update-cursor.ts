import type {
  GetMachineTaskUpdateCursorInput,
  MachineTaskUpdateCursorResult,
} from './assigned-tasks-types';
import { assertMachineSnapshotAccess } from './machine-assigned-task-snapshot-sync';
import type { QueryCtx } from '../../../../convex/_generated/server';

export async function getMachineTaskUpdateCursor(
  ctx: QueryCtx,
  input: GetMachineTaskUpdateCursorInput
): Promise<MachineTaskUpdateCursorResult> {
  if (!(await assertMachineSnapshotAccess(ctx, input.machineId, input.userId)))
    return { latestRevision: 0, updatedAt: 0 };
  const row = await ctx.db
    .query('chatroom_machineTaskUpdateCursors')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .unique();
  return row
    ? { latestRevision: row.latestRevision, updatedAt: row.updatedAt }
    : { latestRevision: 0, updatedAt: 0 };
}
