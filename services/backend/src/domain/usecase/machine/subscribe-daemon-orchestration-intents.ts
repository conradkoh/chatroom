/**
 * Use Case: subscribe daemon-orchestration intents for a machine (indexed cursor).
 * P7 user-message intent feed — daemon pulls new intent rows since a revisionKey.
 */

// fallow-ignore-file code-duplication coverage-gaps
import type {
  DaemonOrchestrationIntentSignal,
  SubscribeDaemonOrchestrationIntentsInput,
  SubscribeDaemonOrchestrationIntentsResult,
} from './daemon-orchestration-intent-types';
import { assertMachineSnapshotAccess } from './machine-assigned-task-snapshot-sync';
import type { Doc } from '../../../../convex/_generated/dataModel';
import type { QueryCtx } from '../../../../convex/_generated/server';

export type { SubscribeDaemonOrchestrationIntentsResult } from './daemon-orchestration-intent-types';

type IntentDoc = Doc<'chatroom_daemonOrchestrationIntents'>;

function intentDocToSignal(doc: IntentDoc): DaemonOrchestrationIntentSignal {
  return {
    revisionKey: doc.revisionKey,
    machineId: doc.machineId,
    chatroomId: doc.chatroomId,
    taskId: doc.taskId,
    messageId: doc.messageId,
    role: doc.role,
    intentType: doc.intentType,
    agentHarness: doc.agentHarness,
    workingDir: doc.workingDir,
    model: doc.model,
    createdAt: doc.createdAt,
  };
}

/**
 * Page intents by (machineId, revisionKey) cursor, pending only.
 * `limit + 1` detects hasMore; highKey is the last delivered revisionKey.
 */
export async function subscribeDaemonOrchestrationIntentsForMachine(
  ctx: QueryCtx,
  input: SubscribeDaemonOrchestrationIntentsInput
): Promise<SubscribeDaemonOrchestrationIntentsResult> {
  if (!input.userId) return { items: [], highKey: null, hasMore: false };
  const allowed = await assertMachineSnapshotAccess(ctx, input.machineId, input.userId);
  if (!allowed) return { items: [], highKey: null, hasMore: false };

  const afterKey = input.afterKey ?? '';
  const page = await ctx.db
    .query('chatroom_daemonOrchestrationIntents')
    .withIndex('by_machineId_revisionKey', (q) =>
      q.eq('machineId', input.machineId).gt('revisionKey', afterKey)
    )
    .filter((q) => q.eq(q.field('status'), 'pending'))
    .order('asc')
    .take(input.limit + 1);

  const hasMore = page.length > input.limit;
  const items = page.slice(0, input.limit).map(intentDocToSignal);
  const lastItem = items.at(-1);
  return {
    items,
    highKey: lastItem ? lastItem.revisionKey : null,
    hasMore,
  };
}
