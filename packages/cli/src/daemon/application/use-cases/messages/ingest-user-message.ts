import type { DatabaseSync } from 'node:sqlite';

import { api } from '../../../../api.js';
import { createDaemonTaskId } from '../../../domain/entities/daemon-task-id.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import type { OrchestrationTaskReadyEvent } from '../../../domain/usecase/execute-handoff.js';
import { appendOutboundEventWithOutbox } from '../../../infrastructure/persistence/event-store.js';
import {
  getProcessedInboundTaskId,
  hasProcessedInboundMessage,
  markInboundMessageProcessed,
} from '../../../infrastructure/persistence/processed-inbound-messages.js';
import {
  upsertTaskReadModel,
  type TaskReadModelStatus,
} from '../../../infrastructure/persistence/read-models/tasks.js';
import { runInTransaction } from '../../../infrastructure/persistence/transaction.js';

export type IngestUserMessageInput = {
  chatroomId: string;
  messageId: string;
  content: string;
  senderRole: string;
  entryPointRole: string;
};

export async function ingestUserMessage(
  deps: {
    db: DatabaseSync;
    machineId: string;
    sessionId: string;
    appendEvent: (event: OutboundEvent) => void;
    emitOrchestrationEvent?: (
      event: OrchestrationTaskReadyEvent & { source: 'user-message' }
    ) => void;
    getAgentHarness: (chatroomId: string, role: string) => Promise<string | undefined>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    now?: () => number;
  },
  input: IngestUserMessageInput
): Promise<{ newTaskId: string }> {
  if (input.senderRole.toLowerCase() !== 'user')
    throw new Error('Only user messages may be ingested');
  if (hasProcessedInboundMessage(deps.db, input.chatroomId, input.messageId)) {
    const existing = getProcessedInboundTaskId(deps.db, input.chatroomId, input.messageId);
    if (existing) return { newTaskId: existing };
  }

  const harness =
    (await deps.getAgentHarness(input.chatroomId, input.entryPointRole)) ?? 'opencode';
  const now = deps.now?.() ?? Date.now();

  type ConvexTaskRow = {
    _id: string;
    sourceMessageId?: string;
    daemonTaskId?: string;
    content: string;
    status: string;
    assignedTo?: string;
    createdAt: number;
    updatedAt: number;
  };

  const activeTasks = (await deps.query(api.tasks.listActiveTasks, {
    sessionId: deps.sessionId,
    chatroomId: input.chatroomId,
  })) as ConvexTaskRow[] | undefined;
  const existingConvexTask = activeTasks?.find((task) => task.sourceMessageId === input.messageId);
  if (existingConvexTask) {
    const readModelTaskId = existingConvexTask.daemonTaskId ?? existingConvexTask._id;
    runInTransaction(deps.db, () => {
      if (hasProcessedInboundMessage(deps.db, input.chatroomId, input.messageId)) return;
      upsertTaskReadModel(deps.db, {
        chatroomId: input.chatroomId,
        role: input.entryPointRole,
        taskId: readModelTaskId,
        status: existingConvexTask.status as TaskReadModelStatus,
        taskContent: existingConvexTask.content,
        assignedTo: existingConvexTask.assignedTo ?? input.entryPointRole,
        agentHarness: harness,
        machineId: deps.machineId,
        createdAt: existingConvexTask.createdAt,
        updatedAt: existingConvexTask.updatedAt ?? now,
      });
      markInboundMessageProcessed(deps.db, input.chatroomId, input.messageId, readModelTaskId, now);
    });
    deps.emitOrchestrationEvent?.({
      chatroomId: input.chatroomId,
      role: input.entryPointRole,
      taskId: readModelTaskId,
      source: 'user-message',
    });
    return { newTaskId: readModelTaskId };
  }

  const taskId = createDaemonTaskId();
  const event = {
    type: 'user-message.received',
    idempotencyKey: `${input.chatroomId}:${input.messageId}`,
    sessionId: deps.sessionId,
    chatroomId: input.chatroomId,
    messageId: input.messageId,
    content: input.content,
    senderRole: input.senderRole,
    newTaskId: taskId,
    timestamp: now,
  } as const;
  let created = false;
  runInTransaction(deps.db, () => {
    if (hasProcessedInboundMessage(deps.db, input.chatroomId, input.messageId)) return;
    upsertTaskReadModel(deps.db, {
      chatroomId: input.chatroomId,
      role: input.entryPointRole,
      taskId,
      status: 'pending',
      taskContent: input.content,
      assignedTo: input.entryPointRole,
      agentHarness: harness,
      machineId: deps.machineId,
      createdAt: now,
      updatedAt: now,
    });
    appendOutboundEventWithOutbox(deps.db, event);
    markInboundMessageProcessed(deps.db, input.chatroomId, input.messageId, taskId, now);
    created = true;
  });
  void created;
  {
    deps.emitOrchestrationEvent?.({
      chatroomId: input.chatroomId,
      role: input.entryPointRole,
      taskId,
      source: 'user-message',
    });
  }
  return { newTaskId: taskId };
}
