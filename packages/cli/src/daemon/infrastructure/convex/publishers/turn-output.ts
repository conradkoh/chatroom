import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { ConvexOutputRepository } from '../../../../infrastructure/repos/convex-output-repository.js';
import { ConvexSessionRepository } from '../../../../infrastructure/repos/convex-session-repository.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createTurnOutputPublisher(deps: ConvexPublisherDeps): Publisher {
  const outputRepository = new ConvexOutputRepository({
    backend: deps.backend,
    sessionId: deps.sessionId,
  });
  const sessionRepository = new ConvexSessionRepository({
    backend: deps.backend,
    sessionId: deps.sessionId,
  });

  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type === 'turn.chunk') {
        await outputRepository.appendChunks(event.harnessSessionId, [
          {
            content: event.content,
            timestamp: event.timestamp,
            messageId: event.messageId,
            partType:
              event.partType === 'text' || event.partType === 'reasoning'
                ? event.partType
                : undefined,
          },
        ]);
        return;
      }

      if (event.type === 'turn.completed') {
        await sessionRepository.finalizeAssistantTurn(event.turnId);
      }
    },
  };
}
