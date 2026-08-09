// fallow-ignore-file code-duplication
import { randomUUID } from 'node:crypto';

import type {
  SubmitOrchestrationIngressInput,
  SubmitOrchestrationIngressResult,
} from './orchestration-ingress-types';
import { isDaemonOrchestrationP9UserMessageEnabled } from '../../../../config/daemonOrchestrationFlags';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { getTeamEntryPoint } from '../../entities/team';
import { resolvePlannerEnhancerEnabledFromConfig } from '../enhancer/resolve-planner-enhancer-enabled';

const INGRESS_TTL_MS = 5 * 60 * 1000;

// fallow-ignore-next-line complexity
export async function submitOrchestrationIngress(
  ctx: MutationCtx,
  args: SubmitOrchestrationIngressInput
): Promise<SubmitOrchestrationIngressResult> {
  if (!isDaemonOrchestrationP9UserMessageEnabled()) {
    return { ok: false, reason: 'flag_off' };
  }

  const chatroom = await ctx.db.get('chatroom_rooms', args.chatroomId);
  if (!chatroom || chatroom.status !== 'active') {
    return { ok: false, reason: 'chatroom_not_active' };
  }

  const trimmed = args.content.trim();
  if (!trimmed) {
    return { ok: false, reason: 'empty_content' };
  }

  const machineId = chatroom.orchestrationMachineId;
  if (!machineId) {
    return { ok: false, reason: 'host_unbound' };
  }

  const ingressId = randomUUID();
  const createdAt = Date.now();
  const revisionKey = `${createdAt}:${ingressId}`;
  const targetRole = args.targetRole ?? getTeamEntryPoint(chatroom) ?? undefined;

  let plannerEnhancerEnabled = args.plannerEnhancerEnabled;
  if (plannerEnhancerEnabled === undefined) {
    const config = await ctx.db
      .query('chatroom_enhancerConfigs')
      .withIndex('by_chatroom_user', (q) =>
        q.eq('chatroomId', args.chatroomId).eq('userId', args.userId)
      )
      .unique();
    plannerEnhancerEnabled = resolvePlannerEnhancerEnabledFromConfig(config);
  }

  await ctx.db.insert('chatroom_orchestrationIngress', {
    chatroomId: args.chatroomId,
    machineId,
    revisionKey,
    ingressId,
    content: trimmed,
    senderRole: 'user',
    targetRole,
    ...(args.attachedTaskIds?.length ? { attachedTaskIds: args.attachedTaskIds } : {}),
    ...(args.attachedBacklogItemIds?.length
      ? { attachedBacklogItemIds: args.attachedBacklogItemIds }
      : {}),
    ...(args.attachedMessageIds?.length ? { attachedMessageIds: args.attachedMessageIds } : {}),
    ...(args.attachedSnippets?.length ? { attachedSnippets: args.attachedSnippets } : {}),
    ...(args.sourcePlatform ? { sourcePlatform: args.sourcePlatform } : {}),
    ...(args.scheduledPromptId ? { scheduledPromptId: args.scheduledPromptId } : {}),
    ...(plannerEnhancerEnabled !== undefined ? { plannerEnhancerEnabled } : {}),
    userId: args.userId,
    createdAt,
    expiresAt: createdAt + INGRESS_TTL_MS,
  });

  await ctx.db.patch('chatroom_rooms', args.chatroomId, { lastActivityAt: createdAt });

  return { ok: true, ingressId };
}
