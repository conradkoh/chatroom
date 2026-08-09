// fallow-ignore-file code-duplication
import type {
  OrchestrationIngressSignal,
  SubscribeOrchestrationIngressInput,
  SubscribeOrchestrationIngressResult,
} from './orchestration-ingress-types';
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';
import { assertMachineSnapshotAccess } from '../machine/machine-assigned-task-snapshot-sync';

type IngressDoc = Doc<'chatroom_orchestrationIngress'>;

function ingressDocToSignal(doc: IngressDoc): OrchestrationIngressSignal {
  return {
    revisionKey: doc.revisionKey,
    ingressId: doc.ingressId,
    machineId: doc.machineId,
    chatroomId: doc.chatroomId,
    content: doc.content,
    senderRole: doc.senderRole,
    targetRole: doc.targetRole,
    attachedTaskIds: doc.attachedTaskIds,
    attachedBacklogItemIds: doc.attachedBacklogItemIds,
    attachedMessageIds: doc.attachedMessageIds,
    attachedSnippets: doc.attachedSnippets,
    sourcePlatform: doc.sourcePlatform,
    scheduledPromptId: doc.scheduledPromptId,
    plannerEnhancerEnabled: doc.plannerEnhancerEnabled,
    userId: doc.userId,
    createdAt: doc.createdAt,
    expiresAt: doc.expiresAt,
  };
}

// fallow-ignore-next-line complexity
export async function subscribeOrchestrationIngressForMachine(
  ctx: QueryCtx,
  input: SubscribeOrchestrationIngressInput
): Promise<SubscribeOrchestrationIngressResult> {
  if (!input.userId) return { items: [], highKey: null, hasMore: false };
  const allowed = await assertMachineSnapshotAccess(ctx, input.machineId, input.userId);
  if (!allowed) return { items: [], highKey: null, hasMore: false };

  const now = Date.now();
  const afterKey = input.afterKey ?? '';
  const page = await ctx.db
    .query('chatroom_orchestrationIngress')
    .withIndex('by_machineId_revisionKey', (q) =>
      q.eq('machineId', input.machineId).gt('revisionKey', afterKey)
    )
    .filter((q) => q.gt(q.field('expiresAt'), now))
    .order('asc')
    .take(input.limit + 1);

  const hasMore = page.length > input.limit;
  const items = page.slice(0, input.limit).map(ingressDocToSignal);
  const lastItem = items.at(-1);
  return {
    items,
    highKey: lastItem ? lastItem.revisionKey : null,
    hasMore,
  };
}
