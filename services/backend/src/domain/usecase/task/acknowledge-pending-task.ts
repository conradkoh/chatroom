import { transitionTask } from './transition-task';
import type { Doc, Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { transitionAgentStatus } from '../agent/transition-agent-status';
import { syncMessageReadModel } from '../message/message-read-model';

/** Transitions a pending task to acknowledged and emits task.acknowledged for the role. */
export async function acknowledgePendingTask(
  ctx: MutationCtx,
  args: {
    chatroomId: Id<'chatroom_rooms'>;
    role: string;
    pendingTask: Doc<'chatroom_tasks'>;
  }
): Promise<void> {
  const now = Date.now();

  await transitionTask(ctx, args.pendingTask._id, 'acknowledged', 'claimTask', {
    assignedTo: args.role,
  });

  if (args.pendingTask.sourceMessageId) {
    const sourceMessage = await ctx.db.get('chatroom_messages', args.pendingTask.sourceMessageId);
    if (sourceMessage && !sourceMessage.acknowledgedAt) {
      await ctx.db.patch('chatroom_messages', args.pendingTask.sourceMessageId, {
        acknowledgedAt: now,
      });
      await syncMessageReadModel(ctx, args.pendingTask.sourceMessageId);
    }
  }

  await transitionAgentStatus(ctx, args.chatroomId, args.role, 'task.acknowledged');
}
