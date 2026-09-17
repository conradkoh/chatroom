import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { getActiveTeamStructure } from '../team/active-team-structure';

type ActiveTaskStatus = 'pending' | 'acknowledged' | 'in_progress';
type LaunchRequest = Doc<'chatroom_agentLastSentLaunchRequests'>;

type TaskStatusView = {
  taskId: Id<'chatroom_tasks'>;
  chatroomId: Id<'chatroom_rooms'>;
  status: ActiveTaskStatus;
  assignedTo?: string;
  updatedAt: number;
  createdAt: number;
  agentConfig: { role: string; machineId: string };
  requestsNativeColdSession?: boolean;
};

// fallow-ignore-next-line complexity
export async function listCurrentRemoteRequests(
  ctx: QueryCtx,
  machineId: string
): Promise<readonly LaunchRequest[]> {
  const requests = await ctx.db
    .query('chatroom_agentLastSentLaunchRequests')
    .withIndex('by_machineId', (q) => q.eq('machineId', machineId))
    .collect();
  const latest = new Map<string, LaunchRequest>();

  for (const request of requests) {
    if (request.agentType !== 'remote') continue;
    const structure = await getActiveTeamStructure(ctx, request.chatroomId);
    if (!structure || structure.teamStructureId !== request.teamStructureId) continue;
    const key = `${request.chatroomId}:${request.role.toLowerCase()}`;
    const current = latest.get(key);
    if (!current || request.requestedAt > current.requestedAt) latest.set(key, request);
  }
  return [...latest.values()];
}

async function listTasksForRequest(
  ctx: QueryCtx,
  request: LaunchRequest,
  machineId: string
): Promise<TaskStatusView[]> {
  const statuses = ['pending', 'acknowledged', 'in_progress'] as const;
  const groups = await Promise.all(
    statuses.map((status) =>
      ctx.db
        .query('chatroom_tasks')
        .withIndex('by_chatroom_status', (q) =>
          q.eq('chatroomId', request.chatroomId).eq('status', status)
        )
        .collect()
    )
  );
  const role = request.role.toLowerCase();

  return groups.flatMap((tasks) =>
    tasks
      .filter((task) => task.assignedTo?.toLowerCase() === role)
      .map((task) => ({
        taskId: task._id,
        chatroomId: task.chatroomId,
        status: task.status as ActiveTaskStatus,
        ...(task.assignedTo === undefined ? {} : { assignedTo: task.assignedTo }),
        updatedAt: task.updatedAt,
        createdAt: task.createdAt,
        agentConfig: { role: request.role, machineId },
        ...(task.startInNewSession === undefined
          ? {}
          : { requestsNativeColdSession: task.startInNewSession }),
      }))
  );
}

/**
 * Returns authoritative deliverable task status for roles launched on a
 * machine. Task content and inbox lifecycle are intentionally excluded: this
 * is a read-only status feed used to rehydrate the daemon's local model.
 */
export async function listAssignedTaskStatusForMachine(
  ctx: QueryCtx,
  args: { machineId: string }
): Promise<TaskStatusView[]> {
  const requests = await listCurrentRemoteRequests(ctx, args.machineId);
  const groups = await Promise.all(
    requests.map((request) => listTasksForRequest(ctx, request, args.machineId))
  );
  return groups.flat().sort((a, b) => a.createdAt - b.createdAt);
}
