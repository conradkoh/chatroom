import type {
  ListMachineAssignedTaskChangesInput,
  ListMachineAssignedTaskChangesResult,
} from './assigned-tasks-types';
import { assertMachineSnapshotAccess } from './machine-assigned-task-snapshot-sync';
import type { QueryCtx } from '../../../../convex/_generated/server';

export async function listMachineAssignedTaskChanges(
  ctx: QueryCtx,
  input: ListMachineAssignedTaskChangesInput
): Promise<ListMachineAssignedTaskChangesResult> {
  if (!(await assertMachineSnapshotAccess(ctx, input.machineId, input.userId)))
    return { items: [], highRevision: null, hasMore: false };
  const rows = await ctx.db
    .query('chatroom_machineAssignedTaskChanges')
    .withIndex('by_machineId_revision', (q) =>
      q.eq('machineId', input.machineId).gt('revision', input.afterRevision ?? 0)
    )
    .take(input.limit + 1);
  const items = rows
    .slice(0, input.limit)
    .map((row) => ({
      revision: row.revision,
      op: row.op,
      taskId: row.taskId,
      role: row.role,
      ...(row.snapshot ? { snapshot: row.snapshot as any } : {}),
    }));
  return {
    items,
    highRevision: items.at(-1)?.revision ?? null,
    hasMore: rows.length > input.limit,
  };
}
