import { isEphemeralAgentRole } from '@workspace/shared/domain/agent-role';

import { releaseEphemeralAgentRole } from './release-ephemeral-agent-role';
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

export async function requestEphemeralAgentRelease(
  ctx: MutationCtx,
  task: Doc<'chatroom_tasks'>
): Promise<void> {
  const role = task.assignedTo?.trim();
  if (!role || !isEphemeralAgentRole(role)) return;
  await releaseEphemeralAgentRole(ctx, { chatroomId: task.chatroomId, role });
}
