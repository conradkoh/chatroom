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
  // Read the slim projection so this query never loads chatroom_tasks.content.
  const headers = await ctx.db
    .query('chatroom_activeTaskHeaders')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', request.chatroomId))
    .collect();
  const role = request.role.toLowerCase();

  return headers
    .filter((header) => header.assignedTo.toLowerCase() === role)
    .map((header) => ({
      taskId: header.taskId,
      chatroomId: header.chatroomId,
      status: header.status,
      assignedTo: header.assignedTo,
      updatedAt: header.updatedAt,
      createdAt: header.createdAt,
      agentConfig: { role: request.role, machineId },
      ...(header.startInNewSession === undefined
        ? {}
        : { requestsNativeColdSession: header.startInNewSession }),
    }));
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
