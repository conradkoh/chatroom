/**
 * Indexed reads from machine assigned-task snapshot projection.
 */

import { assignedTaskSnapshotFromDoc } from './assigned-task-snapshot-row';
import type {
  AssignedTaskView,
  GetAssignedTaskForActionInput,
  ListMachineAssignedTaskSnapshotsResult,
  MachineAssignedTasksInput,
} from './assigned-tasks-types';
import { assertMachineSnapshotAccess } from './machine-assigned-task-snapshot-sync';
import type { QueryCtx } from '../../../../convex/_generated/server';

export async function listMachineAssignedTaskSnapshotsForMachine(
  ctx: QueryCtx,
  input: MachineAssignedTasksInput
): Promise<ListMachineAssignedTaskSnapshotsResult> {
  const allowed = await assertMachineSnapshotAccess(ctx, input.machineId, input.userId);
  if (!allowed) return { tasks: [] };

  const docs = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_machineId', (q) => q.eq('machineId', input.machineId))
    .collect();

  return { tasks: docs.map(assignedTaskSnapshotFromDoc) };
}

export async function getAssignedTaskForActionFromSnapshots(
  ctx: QueryCtx,
  input: GetAssignedTaskForActionInput
): Promise<AssignedTaskView | null> {
  const allowed = await assertMachineSnapshotAccess(ctx, input.machineId, input.userId);
  if (!allowed) return null;

  const snapshot = await ctx.db
    .query('chatroom_machineAssignedTaskSnapshots')
    .withIndex('by_machineId_taskId_role', (q) =>
      q.eq('machineId', input.machineId).eq('taskId', input.taskId).eq('role', input.role)
    )
    .unique();
  if (!snapshot) return null;

  const task = await ctx.db.get('chatroom_tasks', input.taskId);
  if (!task) return null;

  return {
    ...assignedTaskSnapshotFromDoc(snapshot),
    taskContent: task.content,
    taskEnvelope: task.taskEnvelope,
    startInNewSession: task.startInNewSession,
  };
}
