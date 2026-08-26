import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx , QueryCtx } from '../../../../convex/_generated/server';
import { buildTeamRoleKey } from '../../../../convex/utils/teamRoleKey';
import { normalizeAgentStopRole } from '../../entities/agent-stop-command';

export type RoleStopState = 'idle' | 'pending' | 'stopping' | 'stopped' | 'failed';

export async function deriveRoleStopState(
  ctx: QueryCtx | MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string,
  opts: { isAlive: boolean; desiredState?: 'running' | 'stopped' }
): Promise<{ stopState: RoleStopState; activeStopCommandId?: Id<'chatroom_agentStopCommands'> }> {
  const roleKey = normalizeAgentStopRole(role);
  for (const status of ['pending', 'processing'] as const) {
    const cmd = await ctx.db
      .query('chatroom_agentStopCommands')
      .withIndex('by_chatroom_scopeKey_status', (q) =>
        q.eq('chatroomId', chatroomId).eq('scopeKey', `agent:${roleKey}`).eq('status', status)
      )
      .first();
    if (cmd)
      return {
        stopState: status === 'pending' ? 'pending' : 'stopping',
        activeStopCommandId: cmd._id,
      };
  }
  const latest = await ctx.db
    .query('chatroom_agentStopTargets')
    .withIndex('by_chatroom_role', (q) => q.eq('chatroomId', chatroomId).eq('role', roleKey))
    .order('desc')
    .first();
  const room = latest ? await ctx.db.get('chatroom_rooms', chatroomId) : null;
  const config = room?.teamId
    ? await ctx.db
        .query('chatroom_teamAgentConfigs')
        .withIndex('by_teamRoleKey', (q) =>
          q.eq('teamRoleKey', buildTeamRoleKey(chatroomId, room.teamId!, role))
        )
        .first()
    : null;
  const current =
    latest && config?.spawnedAgentPid === latest.pid && config.machineId === latest.machineId;
  if (current && latest.status === 'failed')
    return { stopState: 'failed', activeStopCommandId: latest.stopCommandId };
  if (current && (latest.status === 'pending' || latest.status === 'processing')) {
    const command = await ctx.db.get('chatroom_agentStopCommands', latest.stopCommandId);
    return {
      stopState: command?.status === 'pending' ? 'pending' : 'stopping',
      activeStopCommandId: latest.stopCommandId,
    };
  }
  if (opts.desiredState === 'stopped' && !opts.isAlive) return { stopState: 'stopped' };
  return { stopState: 'idle' };
}
