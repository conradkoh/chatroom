/**
 * create-task usecase
 *
 * Single entry point for all task creation in a chatroom.
 * Encapsulates status determination (pending vs backlog)
 * and DB insertion.
 *
 * Callers:
 *   - messages.ts _sendMessageHandler (user message tasks, only for pending)
 *   - messages.ts _handoffHandler (handoff tasks)
 *   - tasks.ts createTask mutation (direct task creation)
 *   - promote-queued-message.ts (creates task at promotion time)
 *
 * Note: Queued messages (chatroom_messageQueue) no longer create tasks at send time.
 * Tasks for queued messages are created at promotion time in promote-queued-message.ts.
 *
 * Note: Agent restart for pending tasks is now handled by the daemon's task monitor
 * instead of a backend ensure-agent handler.
 */

import type { ConversationMode } from '@workspace/shared/domain/conversation-mode';
import { normalizeTaskEnvelope, type TaskEnvelopeV1 } from '@workspace/shared/domain/task-envelope';

import {
  adjustTaskCount,
  hasActiveTaskFromSource,
  reconcileActiveTaskCountsFromSource,
} from './task-counts';
import { writeTimelineTaskStatusSignal } from './write-timeline-task-status-signal';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { MutationCtx } from '../../../../convex/_generated/server';
import { normalizeMarkdownContent } from '../../entities/markdown-content';
import { projectAssignedTaskSnapshotsForChatroom } from '../machine/machine-assigned-task-snapshot-sync';

type MaterializedTaskCounts = {
  pending: number;
  acknowledged: number;
  inProgress: number;
};

/** Shared with getTaskCounts — any active-slot task means user messages should queue. */
export function hasActiveTaskFromMaterializedCounts(counts: MaterializedTaskCounts): boolean {
  return counts.pending > 0 || counts.acknowledged > 0 || counts.inProgress > 0;
}

export interface CreateTaskArgs {
  chatroomId: Id<'chatroom_rooms'>;
  createdBy: string;
  content: string;
  /** If provided, forces this status instead of auto-detecting pending vs backlog */
  forceStatus?: 'pending' | undefined;
  assignedTo?: string | undefined;
  sourceMessageId?: Id<'chatroom_messages'> | undefined;
  attachedTaskIds?: Id<'chatroom_tasks'>[] | undefined;
  queuePosition: number;
  plannerEnhancerEnabled?: boolean | undefined;
  conversationMode?: ConversationMode | undefined;
  originUserMessageId?: Id<'chatroom_messages'> | undefined;
  enhancerEnabledAtEnqueue?: boolean | undefined;
  startInNewSession: boolean | undefined;
  /**
   * Optional canonical TaskEnvelopeV1 snapshot. The legacy scalar arguments
   * remain compatibility inputs that only feed normalization when this field
   * is absent; an explicit envelope always wins.
   */
  taskEnvelope?: TaskEnvelopeV1 | undefined;
}

/**
 * Complete persisted policy snapshot plus the scalar compatibility projections
 * derived from it. Legacy scalar columns are written ONLY from this projection
 * so they can never become an independent policy source for an enveloped row.
 */
export function deriveTaskPolicyProjection(envelope: TaskEnvelopeV1) {
  return {
    taskEnvelope: {
      version: envelope.version,
      conversationMode: envelope.conversationMode,
      sessionPolicy: envelope.sessionPolicy,
      handoffWorkflow: {
        preset: envelope.handoffWorkflow.preset,
        phase: envelope.handoffWorkflow.phase,
      },
    },
    conversationMode: envelope.conversationMode,
    plannerEnhancerEnabled: envelope.conversationMode === 'code:enhanced',
    startInNewSession: envelope.sessionPolicy === 'new',
  };
}

export interface CreateTaskResult {
  taskId: Id<'chatroom_tasks'>;
  status: 'pending';
}

/**
 * Returns true if the incoming user message should be staged in chatroom_messageQueue
 * (because an active task is already running), or false if it should be sent directly
 * to chatroom_messages with a new task created immediately.
 *
 * A chatroom is considered "busy" when any task is in one of these states:
 * - 'pending': task created but not yet claimed by an agent
 * - 'acknowledged': agent called get-next-task (pending → acknowledged); task is being
 *   processed — the agent will call task read imminently. This state MUST be included
 *   to prevent user messages from slipping through during the claim→start window.
 * - 'in_progress': agent called task read; actively working
 */
export async function shouldEnqueueMessage(
  ctx: MutationCtx,
  chatroomId: Id<'chatroom_rooms'>
): Promise<boolean> {
  const materializedCounts = await ctx.db
    .query('chatroom_taskCounts')
    .withIndex('by_chatroom', (q) => q.eq('chatroomId', chatroomId))
    .first();

  if (materializedCounts) {
    const fromMaterialized = hasActiveTaskFromMaterializedCounts(materializedCounts);
    if (!fromMaterialized) {
      return false;
    }

    // Cross-check: materialized counters can drift (e.g. pending: 1 with no task row).
    const fromSource = await hasActiveTaskFromSource(ctx, chatroomId);
    if (fromMaterialized !== fromSource) {
      await reconcileActiveTaskCountsFromSource(ctx, chatroomId);
    }
    return fromSource;
  }

  // Migration safety: chatrooms without a counts doc fall back to indexed task scan.
  return hasActiveTaskFromSource(ctx, chatroomId);
}

/**
 * Creates a new task in the chatroom.
 * Status is auto-detected unless forceStatus is provided.
 */
export async function createTask(
  ctx: MutationCtx,
  args: CreateTaskArgs
): Promise<CreateTaskResult> {
  const now = Date.now();

  // Status is always pending for direct task creation
  const status = 'pending' as const;

  // Canonicalize the policy once at the write boundary: an explicit envelope is
  // authoritative; legacy scalar inputs only feed normalization when there is
  // no envelope. The stored row carries a complete structural copy plus the
  // derived scalar projections.
  const taskEnvelope = normalizeTaskEnvelope({
    taskEnvelope: args.taskEnvelope,
    conversationMode: args.conversationMode,
    plannerEnhancerEnabled: args.plannerEnhancerEnabled,
    startInNewSession: args.startInNewSession,
  });
  const policyProjection = deriveTaskPolicyProjection(taskEnvelope);

  const taskId = await ctx.db.insert('chatroom_tasks', {
    chatroomId: args.chatroomId,
    createdBy: args.createdBy,
    content: normalizeMarkdownContent(args.content),
    status,
    ...(args.sourceMessageId !== undefined ? { sourceMessageId: args.sourceMessageId } : {}),
    createdAt: now,
    updatedAt: now,
    queuePosition: args.queuePosition,
    ...(args.assignedTo !== undefined ? { assignedTo: args.assignedTo } : {}),
    ...(args.attachedTaskIds &&
      args.attachedTaskIds.length > 0 && {
        attachedTaskIds: args.attachedTaskIds,
      }),
    ...(args.originUserMessageId ? { originUserMessageId: args.originUserMessageId } : {}),
    ...(args.enhancerEnabledAtEnqueue !== undefined
      ? { enhancerEnabledAtEnqueue: args.enhancerEnabledAtEnqueue }
      : {}),
    // Complete canonical snapshot plus derived scalar projections.
    ...policyProjection,
  });

  // Update materialized task counts
  await adjustTaskCount(ctx, args.chatroomId, 'pending', 1);

  // Note: Agent restart for pending tasks is now handled by the daemon's task monitor.
  // No backend scheduling needed here.

  await projectAssignedTaskSnapshotsForChatroom(ctx, args.chatroomId);

  const createdTask = await ctx.db.get('chatroom_tasks', taskId);
  if (createdTask) {
    await writeTimelineTaskStatusSignal(ctx, createdTask);
  }

  return { taskId, status };
}
