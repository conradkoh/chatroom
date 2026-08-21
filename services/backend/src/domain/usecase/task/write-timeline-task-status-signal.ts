import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';
import { getTeamEntryPoint } from '../../entities/team';

type TaskSignalRouting = {
  targetMachineId?: string;
  targetRole?: string;
};

function buildTimelineTaskStatusSignalKey(
  taskUpdatedAt: number,
  taskId: Doc<'chatroom_tasks'>['_id']
): string {
  return `${String(taskUpdatedAt).padStart(16, '0')}:${taskId}`;
}

async function resolveTaskSignalRouting(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<TaskSignalRouting> {
  const chatroom = await ctx.db.get('chatroom_rooms', task.chatroomId);
  const targetRole =
    task.assignedTo && task.assignedTo.toLowerCase() !== 'user'
      ? task.assignedTo
      : getTeamEntryPoint(chatroom ?? {});

  if (!targetRole) return {};

  const configs = filterTeamAgentConfigsForTeam(
    await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', task.chatroomId))
      .collect(),
    task.chatroomId,
    chatroom?.teamId
  );
  const config = configs.find(
    (candidate) =>
      candidate.type === 'remote' &&
      candidate.machineId &&
      candidate.role.toLowerCase() === targetRole.toLowerCase()
  );

  return {
    targetRole,
    targetMachineId: config?.machineId,
  };
}

export async function writeTimelineTaskStatusSignal(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  const taskUpdatedAt = task.updatedAt ?? task.createdAt;
  const routing = await resolveTaskSignalRouting(ctx, task);
  await ctx.db.insert('chatroom_timelineTaskStatusSignals', {
    chatroomId: task.chatroomId,
    taskId: task._id,
    ...routing,
    taskStatus: task.status,
    signalKey: buildTimelineTaskStatusSignalKey(taskUpdatedAt, task._id),
    taskUpdatedAt,
  });
  if (routing.targetMachineId && routing.targetRole) {
    await ctx.db.insert('chatroom_machineTaskStatusSignals', {
      machineId: routing.targetMachineId,
      chatroomId: task.chatroomId,
      taskId: task._id,
      targetRole: routing.targetRole,
      taskStatus: task.status,
      signalKey: buildTimelineTaskStatusSignalKey(taskUpdatedAt, task._id),
      taskUpdatedAt,
    });
  }
}
