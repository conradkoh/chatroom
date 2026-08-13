import { api } from '../../../../api.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';

function isUserMessageProjectionReplayError(error: unknown): boolean {
  const message = getErrorMessage(error);
  return (
    message.includes('DAEMON_TASK_ID_CONFLICT') ||
    message.includes('already has a projected task') ||
    message.includes('replayed')
  );
}

export function createUserMessageReceivedPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'user-message.received') return;
      try {
        await deps.backend.mutation(api.messages.projectUserMessageFromDaemon, {
          sessionId: deps.sessionId,
          machineId: deps.machineId,
          idempotencyKey: event.idempotencyKey,
          chatroomId: event.chatroomId,
          messageId: event.messageId as never,
          content: event.content,
          senderRole: event.senderRole,
          newTaskId: event.newTaskId,
          timestamp: event.timestamp,
        });
      } catch (error) {
        if (!isUserMessageProjectionReplayError(error)) throw error;
      }
    },
  };
}
