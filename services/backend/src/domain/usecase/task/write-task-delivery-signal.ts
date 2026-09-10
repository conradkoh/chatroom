import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { filterTeamAgentConfigsForTeam } from '../../../../convex/utils/teamRoleKey';
import { getTeamEntryPoint } from '../../entities/team';

export type TaskDeliverySignalProjection = {
  signalKey: string;
  taskUpdatedAt: number;
  source?: 'task_service' | undefined;
};

type TaskDeliveryRoute = {
  targetMachineId?: string | undefined;
  targetRole?: string | undefined;
};

function isRemoteConfigForRole(
  config: { type: string; machineId?: string | undefined; role: string },
  targetRole: string
): config is { type: string; machineId: string; role: string } {
  return (
    config.type === 'remote' &&
    config.machineId !== undefined &&
    config.role.toLowerCase() === targetRole.toLowerCase()
  );
}

function resolveTargetRole(
  task: Doc<'chatroom_tasks'>,
  chatroom: {
    teamEntryPoint?: string | null | undefined;
    teamRoles?: string[] | null | undefined;
  } | null
): string | null {
  if (task.assignedTo && task.assignedTo.toLowerCase() !== 'user') return task.assignedTo;
  return getTeamEntryPoint(chatroom ?? {});
}

async function resolveTaskDeliveryRoute(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<TaskDeliveryRoute> {
  const chatroom = await ctx.db.get('chatroom_rooms', task.chatroomId);
  const targetRole = resolveTargetRole(task, chatroom);
  if (!targetRole) return {};

  const configs = filterTeamAgentConfigsForTeam(
    await ctx.db
      .query('chatroom_teamAgentConfigs')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', task.chatroomId))
      .collect(),
    task.chatroomId,
    chatroom?.teamId
  );
  const config = configs.find((candidate) => isRemoteConfigForRole(candidate, targetRole));

  return {
    targetRole,
    targetMachineId: config?.machineId,
  };
}

/**
 * Daemon-only writer: resolves the remote route for a task and inserts a slim
 * routing/status row into `chatroom_machineTaskDeliverySignals`.
 *
 * Routing: `assignedTo` other than `user` wins; otherwise the chatroom's team
 * entry point. A row is written only when a matching `remote` team-agent
 * config with a `machineId` exists. Local/user/no-machine tasks produce no row.
 * Never touches the timeline table, the legacy daemon table, or any head table.
 */
export async function writeTaskDeliverySignal(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>,
  projection: TaskDeliverySignalProjection
): Promise<void> {
  const routing = await resolveTaskDeliveryRoute(ctx, task);
  if (!routing.targetMachineId || !routing.targetRole) return;

  await ctx.db.insert('chatroom_machineTaskDeliverySignals', {
    machineId: routing.targetMachineId,
    chatroomId: task.chatroomId,
    taskId: task._id,
    targetRole: routing.targetRole,
    taskStatus: task.status,
    signalKey: projection.signalKey,
    taskUpdatedAt: projection.taskUpdatedAt,
    ...(projection.source !== undefined ? { source: projection.source } : {}),
  });
}
