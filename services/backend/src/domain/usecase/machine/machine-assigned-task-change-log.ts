import { monitorRowFromSnapshotDoc } from './assigned-task-monitor-row';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

type Snapshot = Doc<'chatroom_machineAssignedTaskSnapshots'>;
export function shouldRecordTaskStateChange(previous: Snapshot | null, next: Snapshot): boolean {
  if (!previous) return true;
  return [
    'revisionKey',
    'taskStatus',
    'taskAssignedTo',
    'taskUpdatedAt',
    'sessionAugmentation',
    'agentHarness',
    'model',
    'workingDir',
    'spawnedAgentPid',
    'desiredState',
    'circuitState',
    'configUpdatedAt',
    'lastSeenAction',
    'lastStatus',
  ].some((key) => previous[key as keyof Snapshot] !== next[key as keyof Snapshot]);
}
async function append(
  ctx: MutationCtx,
  input: {
    machineId: string;
    taskId: Id<'chatroom_tasks'>;
    role: string;
    op: 'upsert' | 'delete';
    snapshot?: Snapshot;
  }
) {
  const cursor = await ctx.db
    .query('chatroom_machineTaskUpdateCursors')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .unique();
  const revision = (cursor?.latestRevision ?? 0) + 1;
  await ctx.db.insert('chatroom_machineAssignedTaskChanges', {
    machineId: input.machineId,
    revision,
    op: input.op,
    taskId: input.taskId,
    role: input.role,
    ...(input.snapshot ? { snapshot: monitorRowFromSnapshotDoc(input.snapshot) } : {}),
  });
  const fields = { machineId: input.machineId, latestRevision: revision, updatedAt: Date.now() };
  if (cursor) await ctx.db.patch('chatroom_machineTaskUpdateCursors', cursor._id, fields);
  else await ctx.db.insert('chatroom_machineTaskUpdateCursors', fields);
}
export async function recordAssignedTaskUpsertChange(
  ctx: MutationCtx,
  row: Snapshot
): Promise<void> {
  await append(ctx, {
    machineId: row.machineId,
    taskId: row.taskId,
    role: row.role,
    op: 'upsert',
    snapshot: row,
  });
}
export async function recordAssignedTaskDeleteChange(
  ctx: MutationCtx,
  input: { machineId: string; taskId: Id<'chatroom_tasks'>; role: string }
): Promise<void> {
  await append(ctx, { ...input, op: 'delete' });
}
