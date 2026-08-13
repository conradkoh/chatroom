import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { EnqueueEnhancerQueueInput } from '../../application/ports/enhancer-queue.port.js';
import type { HandoffChatroomContext } from '../../infrastructure/convex/adapters/handoff-chatroom-adapter.js';
import { upsertHandoffReadModel } from '../../infrastructure/persistence/read-models/handoffs.js';
import { upsertParticipantReadModel } from '../../infrastructure/persistence/read-models/participants.js';
import {
  findNextQueuedTaskForChatroom,
  findTopPendingTaskForSender,
  listActiveTaskReadModelsForChatroom,
  type TaskReadModelRow,
  upsertTaskReadModel,
} from '../../infrastructure/persistence/read-models/tasks.js';
import type { OutboundEvent } from '../entities/outbound-event.js';
import type { ExecuteHandoffResult, HandoffRejectedError } from '../errors/handoff-errors.js';
import { buildHandoffCompletedEvent } from '../events/handoff-completed.js';
import { isNativeHarness } from '../native-integration/index.js';
import { appendOutboundEventWithOutbox } from '../../infrastructure/persistence/event-store.js';

export interface HandoffChatroomPort {
  getContext(chatroomId: string): Promise<HandoffChatroomContext>;
  getAgentHarness(chatroomId: string, role: string): Promise<string | undefined>;
}

export type ExecuteHandoffInput = {
  sessionId: string;
  chatroomId: string;
  senderRole: string;
  content: string;
  targetRole: string;
};

export type ExecuteHandoffDeps = {
  emitOrchestrationEvent?: (event: OrchestrationTaskReadyEvent) => void;
  db: DatabaseSync;
  machineId: string;
  chatroom: HandoffChatroomPort;
  appendEvent: (event: OutboundEvent) => void;
  /** P4: enqueue the enhancer job in the local queue on planner → enhancer handoff. */
  enqueueEnhancerJob?: (input: EnqueueEnhancerQueueInput) => void;
  now?: () => number;
};
export type OrchestrationTaskReadyEvent = {
  chatroomId: string;
  role: string;
  taskId: string;
  source: 'handoff' | 'promotion' | 'user-message';
};

type NormalizedHandoff = {
  normalizedSenderRole: string;
  normalizedTargetRole: string;
  isHandoffToUser: boolean;
  isHandoffToEnhancer: boolean;
};

function reject(error: HandoffRejectedError): ExecuteHandoffResult {
  return {
    success: false,
    error,
    messageId: null,
    completedTaskIds: [],
    newTaskId: null,
    promotedTaskId: null,
  };
}

function runInTransaction(db: DatabaseSync, fn: () => void): void {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function completeTaskRow(row: TaskReadModelRow, now: number): TaskReadModelRow {
  return {
    ...row,
    status: 'completed' as TaskReadModelRow['status'],
    updatedAt: now,
  };
}

function normalizeHandoff(input: ExecuteHandoffInput): NormalizedHandoff {
  const normalizedSenderRole = input.senderRole.toLowerCase();
  const normalizedTargetRole = input.targetRole.toLowerCase();
  return {
    normalizedSenderRole,
    normalizedTargetRole,
    isHandoffToUser: normalizedTargetRole === 'user',
    isHandoffToEnhancer: normalizedTargetRole === 'enhancer',
  };
}

function validateSenderRole(
  normalizedSenderRole: string,
  teamRoles: string[]
): ExecuteHandoffResult | null {
  if (!teamRoles.includes(normalizedSenderRole)) {
    return reject({
      code: 'INVALID_ROLE',
      message: `Invalid senderRole: "${normalizedSenderRole}" is not in team configuration. Allowed roles: ${teamRoles.join(', ')}`,
    });
  }
  return null;
}

function validateEnhancerHandoff(
  handoff: NormalizedHandoff,
  context: HandoffChatroomContext,
  db: DatabaseSync,
  chatroomId: string
): ExecuteHandoffResult | null {
  if (!handoff.isHandoffToEnhancer) {
    return null;
  }
  if (handoff.normalizedSenderRole !== 'planner') {
    return reject({
      code: 'INVALID_ROLE',
      message: 'Only planner can hand off to enhancer',
    });
  }
  if (context.hasActiveEnhancerWork) {
    return reject({
      code: 'ACTIVE_JOB_EXISTS',
      message: 'An enhancer job is already active for this handoff',
    });
  }
  const enhancerConfig = context.enhancerConfig;
  if (!enhancerConfig?.enabled) {
    return reject({
      code: 'ENHANCER_NOT_ENABLED',
      message: 'Enhancer not enabled',
    });
  }
  if (!enhancerConfig.machineId || !enhancerConfig.agentHarness || !enhancerConfig.model) {
    return reject({
      code: 'ENHANCER_CONFIG_INCOMPLETE',
      message:
        'Enhancer configuration is incomplete. Configure harness, model, and machine before handing off.',
    });
  }
  const activePlannerTasks = listActiveTaskReadModelsForChatroom(db, chatroomId).filter(
    (task) => task.assignedTo?.toLowerCase() === 'planner'
  );
  if (activePlannerTasks.length === 0) {
    return reject({
      code: 'NO_PLANNER_USER_TASK',
      message: 'Cannot hand off to enhancer without an active planner task from a user instruction',
    });
  }
  return null;
}

function validateTargetRole(
  handoff: NormalizedHandoff,
  teamRoles: string[]
): ExecuteHandoffResult | null {
  const { normalizedTargetRole, isHandoffToUser, isHandoffToEnhancer } = handoff;
  if (!isHandoffToUser && !isHandoffToEnhancer && !teamRoles.includes(normalizedTargetRole)) {
    return reject({
      code: 'INVALID_TARGET_ROLE',
      message: `Cannot hand off to "${normalizedTargetRole}": this role is not part of the current team. Available targets: ${['user', ...teamRoles].join(', ')}.`,
      suggestedTargets: ['user', ...teamRoles],
    });
  }
  return null;
}

function validateHandoffRequest(
  handoff: NormalizedHandoff,
  context: HandoffChatroomContext,
  db: DatabaseSync,
  chatroomId: string
): ExecuteHandoffResult | null {
  const teamRoles = context.teamRoles;
  const senderError = validateSenderRole(handoff.normalizedSenderRole, teamRoles);
  if (senderError) {
    return senderError;
  }

  if (
    handoff.normalizedSenderRole === 'planner' &&
    (handoff.normalizedTargetRole === 'builder' || handoff.isHandoffToUser) &&
    context.hasActiveEnhancerWork
  ) {
    return reject({
      code: 'ENHANCER_REVIEW_IN_PROGRESS',
      message:
        'Cannot hand off to builder or user while enhancer review is in progress. Run get-next-task and wait for planning feedback, then incorporate it before proceeding.',
    });
  }

  const enhancerError = validateEnhancerHandoff(handoff, context, db, chatroomId);
  if (enhancerError) {
    return enhancerError;
  }

  return validateTargetRole(handoff, teamRoles);
}

async function collectTasksToComplete(
  deps: ExecuteHandoffDeps,
  input: ExecuteHandoffInput,
  handoff: NormalizedHandoff
): Promise<TaskReadModelRow[]> {
  const tasksToComplete = [...listActiveTaskReadModelsForChatroom(deps.db, input.chatroomId)];

  if (handoff.isHandoffToUser) {
    const topPending = findTopPendingTaskForSender(
      deps.db,
      input.chatroomId,
      handoff.normalizedSenderRole
    );
    if (topPending) {
      const senderHarness = await deps.chatroom.getAgentHarness(
        input.chatroomId,
        handoff.normalizedSenderRole
      );
      const isNative = senderHarness !== undefined && isNativeHarness(senderHarness);
      if (!isNative) {
        tasksToComplete.push(topPending);
      }
    }
  }

  return tasksToComplete;
}

type HandoffTransactionResult = {
  messageId: string;
  completedTaskIds: string[];
  newTaskId: string | null;
  promotedTaskId: string | null;
  promotedRole: string | null;
};

function applyHandoffInTransaction(
  deps: ExecuteHandoffDeps,
  input: ExecuteHandoffInput,
  handoff: NormalizedHandoff,
  tasksToComplete: TaskReadModelRow[],
  targetHarness: string | undefined,
  now: number
): HandoffTransactionResult {
  const messageId = randomUUID();
  let newTaskId: string | null = null;
  let promotedTaskId: string | null = null;
  let promotedRole: string | null = null;
  const completedTaskIds: string[] = [];

  runInTransaction(deps.db, () => {
    for (const task of tasksToComplete) {
      upsertTaskReadModel(deps.db, completeTaskRow(task, now));
      completedTaskIds.push(task.taskId);
      appendOutboundEventWithOutbox(deps.db, { type: 'task.status', variant: 'transition', idempotencyKey: `${input.chatroomId}:${task.taskId}:completed:${now}`, taskId: task.taskId, role: task.role, chatroomId: input.chatroomId, status: 'completed', timestamp: now });
    }

    upsertHandoffReadModel(deps.db, {
      chatroomId: input.chatroomId,
      pendingNextRole: handoff.isHandoffToUser ? undefined : handoff.normalizedTargetRole,
      messageId,
      updatedAt: now,
    });

    if (!handoff.isHandoffToUser && targetHarness) {
      newTaskId = randomUUID();
      upsertTaskReadModel(deps.db, {
        chatroomId: input.chatroomId,
        role: handoff.normalizedTargetRole,
        taskId: newTaskId,
        status: 'pending',
        taskContent: input.content,
        assignedTo: handoff.normalizedTargetRole,
        agentHarness: targetHarness,
        machineId: deps.machineId,
        createdAt: now,
        updatedAt: now,
      });
    }

    upsertParticipantReadModel(deps.db, {
      chatroomId: input.chatroomId,
      role: handoff.normalizedSenderRole,
      lastSeenAt: now,
      updatedAt: now,
    });

    if (handoff.isHandoffToUser) {
      const remainingActive = listActiveTaskReadModelsForChatroom(deps.db, input.chatroomId);
      if (remainingActive.length === 0) {
        const queued = findNextQueuedTaskForChatroom(deps.db, input.chatroomId);
        if (queued) {
          promotedTaskId = queued.taskId;
          promotedRole = queued.role;
          upsertTaskReadModel(deps.db, {
            ...queued,
            status: 'pending',
            updatedAt: now,
          });
        }
      }
    }

    appendOutboundEventWithOutbox(deps.db, buildHandoffCompletedEvent({ idempotencyKey: `${input.chatroomId}:${messageId}`, sessionId: input.sessionId, chatroomId: input.chatroomId, senderRole: handoff.normalizedSenderRole, content: input.content, targetRole: handoff.normalizedTargetRole, messageId, completedTaskIds, newTaskId: newTaskId ?? undefined, promotedTaskId: promotedTaskId ?? undefined, timestamp: now }));
  });

  return { messageId, completedTaskIds, newTaskId, promotedTaskId, promotedRole };
}

export async function executeHandoff(
  deps: ExecuteHandoffDeps,
  input: ExecuteHandoffInput
): Promise<ExecuteHandoffResult> {
  const now = deps.now?.() ?? Date.now();
  const handoff = normalizeHandoff(input);
  const context = await deps.chatroom.getContext(input.chatroomId);

  const validationError = validateHandoffRequest(handoff, context, deps.db, input.chatroomId);
  if (validationError) {
    return validationError;
  }

  const tasksToComplete = await collectTasksToComplete(deps, input, handoff);

  const targetHarness = handoff.isHandoffToUser
    ? undefined
    : ((await deps.chatroom.getAgentHarness(input.chatroomId, handoff.normalizedTargetRole)) ??
      'opencode');

  const { messageId, completedTaskIds, newTaskId, promotedTaskId, promotedRole } =
    applyHandoffInTransaction(deps, input, handoff, tasksToComplete, targetHarness, now);

  const enhancerJobPayload =
    handoff.isHandoffToEnhancer && context.enhancerConfig && newTaskId
      ? {
          machineId: context.enhancerConfig.machineId,
          agentHarness: context.enhancerConfig.agentHarness,
          model: context.enhancerConfig.model,
        }
      : undefined;

  if (enhancerJobPayload && deps.enqueueEnhancerJob) {
    deps.enqueueEnhancerJob({
      jobId: `local:${input.chatroomId}:${messageId}`,
      chatroomId: input.chatroomId,
      machineId: enhancerJobPayload.machineId,
      payload: {
        agentHarness: enhancerJobPayload.agentHarness,
        model: enhancerJobPayload.model,
        machineId: enhancerJobPayload.machineId,
        content: input.content,
      },
    });
  }

  {
    if (newTaskId)
      deps.emitOrchestrationEvent?.({
        chatroomId: input.chatroomId,
        role: handoff.normalizedTargetRole,
        taskId: newTaskId,
        source: 'handoff',
      });
    if (promotedTaskId && promotedRole)
      deps.emitOrchestrationEvent?.({
        chatroomId: input.chatroomId,
        role: promotedRole,
        taskId: promotedTaskId,
        source: 'promotion',
      });
  }

  return {
    success: true,
    messageId,
    completedTaskIds,
    newTaskId,
    promotedTaskId,
    supportsNativeIntegration: context.supportsNativeIntegration,
  };
}
