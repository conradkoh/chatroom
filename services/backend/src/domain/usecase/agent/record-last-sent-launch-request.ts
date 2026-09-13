import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { AgentHarness, AgentType } from '../../entities/agent';

export interface LastSentLaunchRequestInput {
  requestId: string;
  commandId: string;
  chatroomId: Id<'chatroom_rooms'>;
  teamStructureId: string;
  role: string;
  agentType: AgentType;
  machineId: string;
  workspaceId?: Id<'chatroom_workspaces'> | undefined;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  wantResume: boolean;
  requestedBy: Id<'users'>;
  requestedAt: number;
}

/**
 * Records the latest complete launch request sent by the webapp for a role.
 * This is a request snapshot, not a desired-state record: the daemon remains
 * authoritative for whether the request was accepted or what is running.
 */
export async function recordLastSentLaunchRequest(
  ctx: MutationCtx,
  input: LastSentLaunchRequestInput
): Promise<Doc<'chatroom_agentLastSentLaunchRequests'>> {
  const requestKey = `${input.chatroomId}:${input.teamStructureId}:${input.role.trim().toLowerCase()}`;
  const existing = await ctx.db
    .query('chatroom_agentLastSentLaunchRequests')
    .withIndex('by_requestKey', (q) => q.eq('requestKey', requestKey))
    .first();

  const fields = {
    requestKey,
    requestId: input.requestId,
    commandId: input.commandId,
    chatroomId: input.chatroomId,
    teamStructureId: input.teamStructureId,
    role: input.role,
    agentType: input.agentType,
    machineId: input.machineId,
    ...(input.workspaceId !== undefined ? { workspaceId: input.workspaceId } : {}),
    agentHarness: input.agentHarness,
    model: input.model,
    workingDir: input.workingDir,
    reason: input.reason,
    wantResume: input.wantResume,
    requestedBy: input.requestedBy,
    requestedAt: input.requestedAt,
  };

  if (existing) {
    await ctx.db.patch('chatroom_agentLastSentLaunchRequests', existing._id, fields);
    const updated = await ctx.db.get('chatroom_agentLastSentLaunchRequests', existing._id);
    if (!updated) throw new Error('Failed to update last-sent launch request');
    return updated;
  }

  const id = await ctx.db.insert('chatroom_agentLastSentLaunchRequests', fields);
  const created = await ctx.db.get('chatroom_agentLastSentLaunchRequests', id);
  if (!created) throw new Error('Failed to create last-sent launch request');
  return created;
}
