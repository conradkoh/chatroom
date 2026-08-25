import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import type { QueryCtx } from '../../../../convex/_generated/server';
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
    const cmd = await ctx.db.query('chatroom_agentStopCommands').withIndex('by_chatroom_scopeKey_status', (q) =>
      q.eq('chatroomId', chatroomId).eq('scopeKey', `agent:${roleKey}`).eq('status', status)).first();
    if (cmd) return { stopState: status === 'pending' ? 'pending' : 'stopping', activeStopCommandId: cmd._id };
  }
  const targets = await ctx.db.query('chatroom_agentStopTargets').withIndex('by_chatroom_role', (q) =>
    q.eq('chatroomId', chatroomId).eq('role', roleKey)).collect();
  const inflight = targets.find((target) => target.status === 'pending' || target.status === 'processing');
  if (inflight) {
    const command = await ctx.db.get('chatroom_agentStopCommands', inflight.stopCommandId);
    return { stopState: command?.status === 'pending' ? 'pending' : 'stopping', activeStopCommandId: inflight.stopCommandId };
  }
  const failed = targets.find((target) => target.status === 'failed');
  if (failed) return { stopState: 'failed', activeStopCommandId: failed.stopCommandId };
  if (opts.desiredState === 'stopped' && !opts.isAlive) return { stopState: 'stopped' };
  return { stopState: 'idle' };
}
