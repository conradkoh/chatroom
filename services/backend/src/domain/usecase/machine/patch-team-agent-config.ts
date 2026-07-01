/**
 * Centralized team agent config writes that always refresh the assigned-task
 * snapshot projection for the affected machine or chatroom.
 */

import {
  projectAssignedTaskSnapshotsForChatroom,
  projectAssignedTaskSnapshotsForMachine,
} from './machine-assigned-task-snapshot-sync';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';

type TeamAgentConfigPatch = Partial<
  Omit<Doc<'chatroom_teamAgentConfigs'>, '_id' | '_creationTime'>
>;

export type PatchTeamAgentConfigOptions = {
  /** Rebuild projection for one machine (default) or all machines in the chatroom. */
  projectScope?: 'chatroom' | 'machine';
};

/**
 * Patch a team agent config and refresh daemon snapshot projection.
 * Use this instead of raw `ctx.db.patch('chatroom_teamAgentConfigs', …)` +
 * manual `syncChatroomAssignedTaskSnapshots`.
 */
// fallow-ignore-next-line complexity
export async function patchTeamAgentConfig(
  ctx: MutationCtx,
  configId: Id<'chatroom_teamAgentConfigs'>,
  patch: TeamAgentConfigPatch,
  options?: PatchTeamAgentConfigOptions
): Promise<Doc<'chatroom_teamAgentConfigs'> | null> {
  const existing = await ctx.db.get('chatroom_teamAgentConfigs', configId);
  if (!existing) {
    return null;
  }

  const now = Date.now();
  await ctx.db.patch('chatroom_teamAgentConfigs', configId, {
    ...patch,
    updatedAt: patch.updatedAt ?? now,
  });

  const scope = options?.projectScope ?? 'machine';
  if (scope === 'chatroom') {
    await projectAssignedTaskSnapshotsForChatroom(ctx, existing.chatroomId);
  } else if (existing.machineId) {
    await projectAssignedTaskSnapshotsForMachine(ctx, existing.machineId);
  } else {
    await projectAssignedTaskSnapshotsForChatroom(ctx, existing.chatroomId);
  }

  return existing;
}
