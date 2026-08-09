import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { api } from '../../../../api.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createUserMessageReceivedPublisher(deps: ConvexPublisherDeps): Publisher {
  return {
    // fallow-ignore-next-line complexity
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'user-message.received') return;

      await deps.backend.mutation(api.messages.projectUserMessageFromDaemon, {
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        idempotencyKey: event.idempotencyKey,
        chatroomId: event.chatroomId,
        localMessageId: event.localMessageId,
        localTaskId: event.localTaskId,
        content: event.content,
        targetRole: event.targetRole,
        assignedRole: event.assignedRole,
        timestamp: event.timestamp,
        ...(event.attachedTaskIds?.length ? { attachedTaskIds: event.attachedTaskIds } : {}),
        ...(event.attachedBacklogItemIds?.length
          ? { attachedBacklogItemIds: event.attachedBacklogItemIds }
          : {}),
        ...(event.attachedMessageIds?.length
          ? { attachedMessageIds: event.attachedMessageIds }
          : {}),
        ...(event.attachedSnippets?.length ? { attachedSnippets: event.attachedSnippets } : {}),
        ...(event.sourcePlatform ? { sourcePlatform: event.sourcePlatform } : {}),
        ...(event.scheduledPromptId ? { scheduledPromptId: event.scheduledPromptId } : {}),
        ...(event.plannerEnhancerEnabled !== undefined
          ? { plannerEnhancerEnabled: event.plannerEnhancerEnabled }
          : {}),
      });
    },
  };
}
