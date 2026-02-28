import type { Id } from '../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../convex/_generated/server';
import { internal } from '../../../convex/_generated/api';
import { getTeamEntryPoint } from '../../domain/entities/team';

export interface OnAgentExitedArgs {
  chatroomId: Id<'chatroom_rooms'>;
  role: string;
  intentional: boolean;
}

/**
 * Handles the `agent.exited` event (backend side).
 *
 * When an agent exits unintentionally (crash), schedules an immediate
 * ensure-agent check for any active task assigned to that role — bypassing
 * the normal staleness guard so crash recovery fires without waiting for
 * the next scheduled timer interval.
 */
export async function onAgentExited(ctx: MutationCtx, args: OnAgentExitedArgs): Promise<void> {
  const { chatroomId, role, intentional } = args;

  if (intentional) {
    return; // No crash recovery needed for intentional stops
  }

  const chatroom = await ctx.db.get('chatroom_rooms', chatroomId);
  const entryPoint = getTeamEntryPoint(chatroom ?? {});
  const normalizedRole = role.toLowerCase();

  const activeTasks = await ctx.db
    .query('chatroom_tasks')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .filter((q) =>
      q.or(
        q.eq(q.field('status'), 'pending'),
        q.eq(q.field('status'), 'acknowledged'),
        q.eq(q.field('status'), 'in_progress')
      )
    )
    .collect();

  const relevantTask = activeTasks.find((task) => {
    const assignedRole = task.assignedTo?.toLowerCase();
    if (assignedRole) return assignedRole === normalizedRole;
    return normalizedRole === entryPoint?.toLowerCase();
  });

  if (relevantTask) {
    await ctx.scheduler.runAfter(0, internal.ensureAgentHandler.check, {
      taskId: relevantTask._id,
      chatroomId,
      snapshotUpdatedAt: 0, // bypass staleness guard — crash recovery
    });
  }
}
