import { authorizeAgentStart } from './authorize-agent-start';
import type { AuthorizeAgentStartReason } from './authorize-agent-start';
import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import { recordAgentSpawnedState } from './record-agent-spawned-state';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export type RegisterSpawnedAgentArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
  pid: number;
  model?: string | undefined;
  harnessSessionId?: string | undefined;
  reason?: string | undefined;
};
export type RegisterSpawnedAgentResult =
  { accepted: true } | { accepted: false; reason: AuthorizeAgentStartReason };

export async function registerSpawnedAgentIfAuthorized(
  ctx: MutationCtx,
  args: RegisterSpawnedAgentArgs
): Promise<RegisterSpawnedAgentResult> {
  const auth = await authorizeAgentStart(ctx, args);
  if (!auth.allowed) return { accepted: false, reason: auth.reason };
  const launchRequest = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
  });
  if (!launchRequest || launchRequest.machineId !== args.machineId)
    return { accepted: false, reason: 'not_configured' };
  const existingStatus = await ctx.db
    .query('chatroom_agentRoleStatusReadModel')
    .withIndex('by_chatroom_role', (q) =>
      q.eq('chatroomId', args.chatroomId).eq('role', args.role.trim().toLowerCase())
    )
    .first();
  if (existingStatus?.observedPid === args.pid) return { accepted: true };
  await recordAgentSpawnedState(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
    machineId: args.machineId,
    pid: args.pid,
    model: args.model,
    harnessSessionId: args.harnessSessionId,
    reason: args.reason,
  });
  return { accepted: true };
}
