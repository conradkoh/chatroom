import { ConvexError } from 'convex/values';

import { normalizeWorkingDir } from './workspace-match';
import { BACKEND_ERROR_CODES, type BackendError } from '../../../../config/errorCodes';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getPrimaryWorkspaceForChatroom } from '../workspace/get-primary-workspace-for-chatroom';

/**
 * One-workspace policy for agent start and restart. A chatroom with an active workspace may only
 * start or restart agents on that workspace's machine and folder. A chatroom with no active
 * workspace accepts the first bind. Throws before any command is enqueued or any row is written.
 */
export async function assertAgentTargetIsActiveWorkspace(
  ctx: MutationCtx,
  input: { chatroomId: Id<'chatroom_rooms'>; machineId: string; workingDir: string }
): Promise<void> {
  const active = await getPrimaryWorkspaceForChatroom(ctx, input.chatroomId);
  if (!active) return;
  const sameMachine = active.machineId === input.machineId;
  const sameFolder =
    normalizeWorkingDir(active.workingDir) === normalizeWorkingDir(input.workingDir);
  if (sameMachine && sameFolder) return;
  throw new ConvexError<BackendError>({
    code: BACKEND_ERROR_CODES.WORKSPACE_ALREADY_BOUND,
    message: `This chatroom is bound to ${active.hostname}:${active.workingDir}. Use Switch workspace to move it.`,
  });
}
