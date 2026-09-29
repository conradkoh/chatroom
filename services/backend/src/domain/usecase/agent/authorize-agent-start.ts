import { getLastSentLaunchRequestForRole } from './get-last-sent-launch-request';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export type AuthorizeAgentStartArgs = {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  machineId: string;
};
export type AuthorizeAgentStartReason = 'stopped' | 'disabled' | 'not_configured';
export type AuthorizeAgentStartResult =
  { allowed: true } | { allowed: false; reason: AuthorizeAgentStartReason };

export async function authorizeAgentStart(
  ctx: MutationCtx,
  args: AuthorizeAgentStartArgs
): Promise<AuthorizeAgentStartResult> {
  const room = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!room) return { allowed: false, reason: 'not_configured' };
  const launchRequest = await getLastSentLaunchRequestForRole(ctx, {
    chatroomId: args.chatroomId,
    role: args.role,
  });
  if (!launchRequest || launchRequest.machineId !== args.machineId)
    return { allowed: false, reason: 'not_configured' };
  return { allowed: true };
}
