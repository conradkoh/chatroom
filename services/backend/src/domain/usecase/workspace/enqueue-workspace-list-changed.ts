import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { isActiveWorkspace } from '../../entities/workspace';
import { enqueueMachineCommand } from '../machine/enqueue-machine-command';

/** Enqueue a lightweight inbox nudge so daemons reconcile watched workspaces. */
export async function enqueueWorkspaceListChangedForChatroom(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<void> {
  const workspaces = await ctx.db.query('chatroom_workspaces').withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId)).collect();
  const machineIds = [...new Set(workspaces.filter((ws) => isActiveWorkspace(ws.removedAt)).map((ws) => ws.machineId))];
  const now = Date.now();
  await Promise.all(machineIds.map((machineId) => enqueueMachineCommand(ctx, { machineId, now, command: { type: 'daemon.workspaceListChanged' } })));
}
