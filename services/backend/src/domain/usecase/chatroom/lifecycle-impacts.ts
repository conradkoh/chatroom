import type { Id } from '../../../../convex/_generated/dataModel';
import type { QueryCtx, MutationCtx } from '../../../../convex/_generated/server';

export type LifecycleAction = 'archive';

export type LifecycleImpactKind = 'scheduled_prompt';

export type LifecycleImpact = { kind: LifecycleImpactKind; count: number };

export async function getChatroomLifecycleImpacts(
  ctx: QueryCtx,
  args: { chatroomId: Id<'chatroom_rooms'>; action: LifecycleAction }
): Promise<LifecycleImpact[]> {
  if (args.action === 'archive') {
    const prompts = await ctx.db
      .query('chatroom_scheduledPrompts')
      .withIndex('by_chatroom', (q) => q.eq('chatroomId', args.chatroomId))
      .collect();
    const count = prompts.filter((p) => p.disabledReason === undefined).length;
    if (count === 0) return [];
    return [{ kind: 'scheduled_prompt', count }];
  }
  return [];
}

export async function disableScheduledPromptsForArchive(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>,
  now: number
): Promise<number> {
  const prompts = await ctx.db
    .query('chatroom_scheduledPrompts')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .collect();
  let disabled = 0;
  for (const prompt of prompts) {
    if (prompt.disabledReason !== undefined) continue;
    await ctx.db.patch('chatroom_scheduledPrompts', prompt._id, {
      disabledReason: 'archive',
      isRunnable: false,
      nextRunAt: undefined,
      updatedAt: now,
    });
    disabled++;
  }
  return disabled;
}
