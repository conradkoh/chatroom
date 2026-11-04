import { releaseEphemeralAgentRole } from './release-ephemeral-agent-role';
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isEphemeralRoleInChatroom } from '../team/resolve-chatroom-team';

export async function requestEphemeralAgentRelease(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  const role = task.assignedTo?.trim();
  if (!role || !(await isEphemeralRoleInChatroom(ctx, task.chatroomId, role))) return;
  await releaseEphemeralAgentRole(ctx, { chatroomId: task.chatroomId, role });
}
