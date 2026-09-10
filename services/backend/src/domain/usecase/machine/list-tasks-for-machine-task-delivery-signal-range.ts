// fallow-ignore-file complexity
import type { AssignedTaskSnapshotView } from './assigned-task-snapshot-contract';
import { assignedTaskSnapshotFromDoc } from './assigned-task-snapshot-row';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type ListTasksForMachineTaskDeliverySignalRangeInput = {
  machineId: string;
  chatroomId: string;
  userId: string;
  afterSignalKey: string;
  throughSignalKey: string;
  limit: number;
};

export type ListTasksForMachineTaskDeliverySignalRangeResult = {
  snapshots: AssignedTaskSnapshotView[];
  nextSignalKey: string | null;
  hasMore: boolean;
};

export async function listTasksForMachineTaskDeliverySignalRange(
  ctx: QueryCtx,
  input: ListTasksForMachineTaskDeliverySignalRangeInput
): Promise<ListTasksForMachineTaskDeliverySignalRangeResult> {
  void input.userId;
  const signals = await ctx.db
    .query('chatroom_machineTaskDeliverySignals')
    .withIndex('by_machineId_chatroomId_signalKey', (q) =>
      q
        .eq('machineId', input.machineId)
        .eq('chatroomId', input.chatroomId as Id<'chatroom_rooms'>)
        .gt('signalKey', input.afterSignalKey)
        .lte('signalKey', input.throughSignalKey)
    )
    .order('asc')
    .take(input.limit + 1);
  const page = signals.slice(0, input.limit);
  const snapshots: AssignedTaskSnapshotView[] = [];

  for (const signal of page) {
    const snapshot = await ctx.db
      .query('chatroom_machineAssignedTaskSnapshots')
      .withIndex('by_machineId_taskId_role', (q) =>
        q.eq('machineId', input.machineId).eq('taskId', signal.taskId).eq('role', signal.targetRole)
      )
      .unique();
    if (!snapshot) continue;
    const task = await ctx.db.get('chatroom_tasks', signal.taskId);
    if (!task || task.assignedTo?.toLowerCase() !== signal.targetRole.toLowerCase()) continue;
    snapshots.push(assignedTaskSnapshotFromDoc(snapshot));
  }

  return {
    snapshots,
    nextSignalKey: page.at(-1)?.signalKey ?? null,
    hasMore: signals.length > input.limit,
  };
}
