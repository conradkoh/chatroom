import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type { OrchestrationTaskReadyEvent } from '../../../domain/usecase/execute-handoff.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import { runInTransaction } from '../../../infrastructure/persistence/transaction.js';
import { upsertTaskReadModel } from '../../../infrastructure/persistence/read-models/tasks.js';
import { isDaemonOrchestrationP3LocalDeliveryEnabled } from '../../../infrastructure/projection/feature-flags.js';
import { appendOutboundEventWithOutbox } from '../../../infrastructure/persistence/event-store.js';
import { getProcessedInboundTaskId, hasProcessedInboundMessage, markInboundMessageProcessed } from '../../../infrastructure/persistence/processed-inbound-messages.js';

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
    emitOrchestrationEvent?: (event: OrchestrationTaskReadyEvent & { source: 'user-message' }) => void;
    getAgentHarness: (chatroomId: string, role: string) => Promise<string | undefined>;
    now?: () => number;
  },
  input: IngestUserMessageInput
): Promise<{ newTaskId: string }> {
  if (input.senderRole.toLowerCase() !== 'user') throw new Error('Only user messages may be ingested');
  if (hasProcessedInboundMessage(deps.db, input.chatroomId, input.messageId)) {
    const existing = getProcessedInboundTaskId(deps.db, input.chatroomId, input.messageId);
    if (existing) return { newTaskId: existing };
  }
  const taskId = randomUUID();
  const now = deps.now?.() ?? Date.now();
  const harness = (await deps.getAgentHarness(input.chatroomId, input.entryPointRole)) ?? 'opencode';
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
    upsertTaskReadModel(deps.db, { chatroomId: input.chatroomId, role: input.entryPointRole, taskId, status: 'pending', taskContent: input.content, assignedTo: input.entryPointRole, agentHarness: harness, machineId: deps.machineId, createdAt: now, updatedAt: now });
    appendOutboundEventWithOutbox(deps.db, event);
    markInboundMessageProcessed(deps.db, input.chatroomId, input.messageId, taskId, now);
    created = true;
  });
  void created;
  if (isDaemonOrchestrationP3LocalDeliveryEnabled()) {
    deps.emitOrchestrationEvent?.({ chatroomId: input.chatroomId, role: input.entryPointRole, taskId, source: 'user-message' });
  }
  return { newTaskId: taskId };
}
