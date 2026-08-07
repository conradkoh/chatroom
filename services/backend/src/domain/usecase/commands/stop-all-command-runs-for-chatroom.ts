/**
 * Use Case: Stop All Command Runs for Chatroom
 *
 * Stops every pending/running command run across all of a chatroom's
 * registered (active) workspaces. Completed/failed/stopped/killed runs are
 * left untouched.
 *
 * Note: runs are keyed by `machineId + workingDir`, so stopping chatroom A may
 * also stop processes for another chatroom sharing the same workspace. This is
 * an accepted tradeoff.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { handleStopCommand } from '../../../../convex/commands/mutations';
import { listWorkspacesForChatroom } from '../workspace/list-workspaces-for-chatroom';

export async function stopAllCommandRunsForChatroom(
  ctx: MutationCtx,
  input: { chatroomId: Id<'chatroom_rooms'> }
): Promise<{ stoppedCount: number }> {
  const workspaces = await listWorkspacesForChatroom(ctx, { chatroomId: input.chatroomId });

  let stoppedCount = 0;
  for (const ws of workspaces) {
    stoppedCount += await stopRunsForWorkspace(ctx, ws.machineId, ws.workingDir);
  }

  return { stoppedCount };
}

async function stopRunsForWorkspace(
  ctx: MutationCtx,
  machineId: string,
  workingDir: string
): Promise<number> {
  const runs = await ctx.db
    .query('chatroom_commandRunsV2')
    .withIndex('by_machine_workingDir', (q) =>
      q.eq('machineId', machineId).eq('workingDir', workingDir)
    )
    .collect();

  let stoppedCount = 0;
  for (const run of runs) {
    // handleStopCommand throws COMMAND_NOT_RUNNING for non-active statuses.
    if (run.status !== 'pending' && run.status !== 'running') continue;
    await handleStopCommand(ctx, { runId: run._id, machineId });
    stoppedCount++;
  }

  return stoppedCount;
}
