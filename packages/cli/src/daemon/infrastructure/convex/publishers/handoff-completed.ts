import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createHandoffCompletedPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'handoff.completed') return;

      await deps.backend.mutation(api.messages.projectHandoffFromDaemon, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        idempotencyKey: event.idempotencyKey,
        chatroomId: event.chatroomId,
        senderRole: event.senderRole,
        content: event.content,
        targetRole: event.targetRole,
        completedTaskIds: event.completedTaskIds,
        ...(event.newTaskId ? { newTaskId: event.newTaskId } : {}),
        ...(event.promotedTaskId ? { promotedTaskId: event.promotedTaskId } : {}),
        timestamp: event.timestamp,
      });
    },
  };
}
