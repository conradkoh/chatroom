/**
 * Use Case: Request Sync on Handoff to User
 *
 * Enqueues a `daemon.gitRefresh` event for every active workspace in a chatroom.
 *
 * Called from the handoff handler when an agent hands off to `user` — the sole
 * automatic trigger for daemon git+command pushes. The daemon consumes these
 * events and pushes git state + command state for each workspace once per
 * delivery.
 */

import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';

/**
 * Enqueue daemon.gitRefresh for every active workspace in the chatroom.
 * Called on handoff-to-user so the daemon pushes git+command state once per delivery.
 *
 * @returns the number of gitRefresh events enqueued (soft-deleted workspaces excluded).
 */
export async function requestSyncOnHandoffToUser(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<number> {
  const workspaces = await ctx.db
    .query('chatroom_workspaces')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();

  const now = Date.now();
  let count = 0;
  for (const ws of workspaces) {
    if (!isActiveWorkspace(ws.removedAt)) continue;
    await ctx.db.insert('chatroom_eventStream', {
      type: 'daemon.gitRefresh',
      machineId: ws.machineId,
      workingDir: ws.workingDir,
      timestamp: now,
    });
    count++;
  }
  return count;
}
