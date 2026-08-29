import { AGENT_STOP_EXPIRY_LEASE_GRACE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { terminalizeExpiredStopCommand } from './terminalize-expired-stop-command';

const INFLIGHT = ['pending', 'processing'] as const;

/** Eagerly terminalize expired inflight stop commands for chatroom + role scopes. */
export async function expireInflightStopCommandsForRole(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  role: string
): Promise<void> {
  const now = Date.now();
  const roleKey = role.trim().toLowerCase();
  for (const scopeKey of ['chatroom', `agent:${roleKey}`] as const)
    for (const status of INFLIGHT) {
      const commands = await ctx.db
        .query('chatroom_agentStopCommands')
        .withIndex('by_chatroom_scopeKey_status', (q) =>
          q.eq('chatroomId', chatroomId).eq('scopeKey', scopeKey).eq('status', status)
        )
        .collect();
      for (const command of commands)
        if (command.deadlineAt != null && now > command.deadlineAt + AGENT_STOP_EXPIRY_LEASE_GRACE_MS)
          await terminalizeExpiredStopCommand(ctx, command._id);
    }
}
