import { normalizeAgentRole } from '@workspace/shared/domain/agent-role';

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { PARTICIPANT_EXITED_ACTION } from '../../entities/participant';
import { getParticipantForChatroomRole } from '../machine/assigned-tasks-core';
import { isEphemeralRoleInChatroom } from '../team/resolve-chatroom-team';

/** Clear ephemeral role presence after on-demand work finishes without a tracked PID. */
// fallow-ignore-next-line complexity
export async function releaseEphemeralAgentRole(
  ctx: MutationCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; role: string }
): Promise<void> {
  const role = normalizeAgentRole(args.role);
  if (!(await isEphemeralRoleInChatroom(ctx, args.chatroomId, role))) return;

  const participant = await getParticipantForChatroomRole(ctx, args.chatroomId, role);

  if (participant) {
    await ctx.db.patch('chatroom_participants', participant._id, {
      lastSeenAction: PARTICIPANT_EXITED_ACTION,
    });
    return;
  }
}
