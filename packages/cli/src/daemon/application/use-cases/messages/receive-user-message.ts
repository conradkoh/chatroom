import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { getNativeTaskDeliveryCoordinator } from '../../../entry/native-delivery/native-task-delivery-coordinator.js';
import {
  listActiveTaskReadModelsForChatroom,
  listTaskReadModelsForChatroom,
  upsertTaskReadModel,
} from '../../../infrastructure/persistence/read-models/tasks.js';
import { isDaemonOrchestrationP9QueueEnabled } from '../../../infrastructure/projection/feature-flags.js';

export type ReceiveUserMessageInput = {
  chatroomId: string;
  content: string;
  targetRole?: string;
  ingressId: string;
  attachedTaskIds?: string[];
  attachedBacklogItemIds?: string[];
  attachedMessageIds?: string[];
  attachedSnippets?: { reference: string; fileSource: string; selectedContent: string }[];
  sourcePlatform?: string;
  scheduledPromptId?: string;
  plannerEnhancerEnabled?: boolean;
};

export type ReceiveUserMessageResult = {
  queued: boolean;
  messageId?: string;
  taskId?: string;
  outboundEvent?: OutboundEvent;
};

export type ReceiveUserMessageDeps = {
  db: DatabaseSync;
  machineId: string;
  now?: () => number;
};

function shouldEnqueueLocally(db: DatabaseSync, chatroomId: string): boolean {
  const active = listActiveTaskReadModelsForChatroom(db, chatroomId);
  if (active.length > 0) return true;
  return listTaskReadModelsForChatroom(db, chatroomId).some((task) => task.status === 'pending');
}

// fallow-ignore-next-line complexity
export function receiveUserMessage(
  deps: ReceiveUserMessageDeps,
  input: ReceiveUserMessageInput
): ReceiveUserMessageResult {
  const now = deps.now?.() ?? Date.now();
  const assignedRole = (input.targetRole ?? 'planner').toLowerCase();

  if (shouldEnqueueLocally(deps.db, input.chatroomId) && !isDaemonOrchestrationP9QueueEnabled()) {
    return { queued: true };
  }

  const messageId = randomUUID();
  const taskId = randomUUID();

  upsertTaskReadModel(deps.db, {
    chatroomId: input.chatroomId,
    role: assignedRole,
    taskId,
    status: 'pending',
    assignedTo: assignedRole,
    agentHarness: 'opencode',
    machineId: deps.machineId,
    createdAt: now,
    updatedAt: now,
  });

  const outboundEvent: OutboundEvent = {
    type: 'user-message.received',
    idempotencyKey: input.ingressId,
    chatroomId: input.chatroomId,
    localMessageId: messageId,
    localTaskId: taskId,
    content: input.content,
    targetRole: input.targetRole,
    assignedRole,
    timestamp: now,
    ...(input.attachedTaskIds?.length ? { attachedTaskIds: input.attachedTaskIds } : {}),
    ...(input.attachedBacklogItemIds?.length
      ? { attachedBacklogItemIds: input.attachedBacklogItemIds }
      : {}),
    ...(input.attachedMessageIds?.length ? { attachedMessageIds: input.attachedMessageIds } : {}),
    ...(input.attachedSnippets?.length ? { attachedSnippets: input.attachedSnippets } : {}),
    ...(input.sourcePlatform ? { sourcePlatform: input.sourcePlatform } : {}),
    ...(input.scheduledPromptId ? { scheduledPromptId: input.scheduledPromptId } : {}),
    ...(input.plannerEnhancerEnabled !== undefined
      ? { plannerEnhancerEnabled: input.plannerEnhancerEnabled }
      : {}),
  };

  getNativeTaskDeliveryCoordinator().tryInjectNextForRole(input.chatroomId, assignedRole);

  return {
    queued: false,
    messageId,
    taskId,
    outboundEvent,
  };
}
