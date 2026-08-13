import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';

export function createUserMessageReceivedPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'user-message.received') return;
      await deps.backend.mutation(api.messages.projectUserMessageFromDaemon, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        idempotencyKey: event.idempotencyKey,
        chatroomId: event.chatroomId,
        messageId: event.messageId,
        content: event.content,
        senderRole: event.senderRole,
        newTaskId: event.newTaskId,
        timestamp: event.timestamp,
      });
    },
  };
}
