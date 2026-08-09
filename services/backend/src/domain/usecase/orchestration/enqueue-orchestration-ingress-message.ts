/**
 * P9 interim: enqueue ingress payload to Convex messageQueue when daemon detects
 * active tasks and P9_QUEUE local queue is not yet enabled.
 */

import type { OrchestrationIngressSignal } from './orchestration-ingress-types';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getAndIncrementQueuePosition } from '../../../../convex/lib/chatroomUtils';
import { getTeamEntryPoint } from '../../entities/team';
import { adjustTaskCount } from '../task/task-counts';

// fallow-ignore-next-line complexity
export async function enqueueOrchestrationIngressMessage(
  ctx: MutationCtx,
  ingress: Pick<
    OrchestrationIngressSignal,
    | 'chatroomId'
    | 'content'
    | 'targetRole'
    | 'attachedTaskIds'
    | 'attachedBacklogItemIds'
    | 'attachedMessageIds'
    | 'attachedSnippets'
    | 'sourcePlatform'
    | 'scheduledPromptId'
    | 'plannerEnhancerEnabled'
  >
): Promise<Id<'chatroom_messageQueue'>> {
  const chatroom = await ctx.db.get('chatroom_rooms', ingress.chatroomId);
  if (!chatroom) {
    throw new Error('Chatroom not found');
  }

  const queuePosition = await getAndIncrementQueuePosition(ctx, chatroom);
  const targetRole = ingress.targetRole ?? getTeamEntryPoint(chatroom) ?? undefined;

  const queuedMessageId = await ctx.db.insert('chatroom_messageQueue', {
    chatroomId: ingress.chatroomId,
    senderRole: 'user',
    targetRole,
    content: ingress.content,
    type: 'message' as const,
    queuePosition,
    ...(ingress.attachedTaskIds?.length ? { attachedTaskIds: ingress.attachedTaskIds } : {}),
    ...(ingress.attachedBacklogItemIds?.length
      ? { attachedBacklogItemIds: ingress.attachedBacklogItemIds }
      : {}),
    ...(ingress.attachedMessageIds?.length
      ? { attachedMessageIds: ingress.attachedMessageIds }
      : {}),
    ...(ingress.attachedSnippets?.length ? { attachedSnippets: ingress.attachedSnippets } : {}),
    ...(ingress.sourcePlatform ? { sourcePlatform: ingress.sourcePlatform } : {}),
    ...(ingress.scheduledPromptId ? { scheduledPromptId: ingress.scheduledPromptId } : {}),
    ...(ingress.plannerEnhancerEnabled !== undefined
      ? { plannerEnhancerEnabled: ingress.plannerEnhancerEnabled }
      : {}),
  });

  await adjustTaskCount(ctx, ingress.chatroomId, 'queueSize', 1);
  await ctx.db.patch('chatroom_rooms', ingress.chatroomId, { lastActivityAt: Date.now() });

  return queuedMessageId;
}
