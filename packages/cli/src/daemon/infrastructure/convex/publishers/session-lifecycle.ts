import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { ConvexSessionRepository } from '../../../../infrastructure/repos/convex-session-repository.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createSessionLifecyclePublisher(deps: ConvexPublisherDeps): Publisher {
  const sessionRepository = new ConvexSessionRepository({
    backend: deps.backend,
    sessionId: deps.sessionId,
  });

  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'session.lifecycle') return;

      const { harnessSessionId, action, opencodeSessionId, sessionTitle } = event;

      switch (action) {
        case 'opened':
          if (!opencodeSessionId || !sessionTitle) return;
          await sessionRepository.associateOpenCodeSessionId(
            harnessSessionId,
            opencodeSessionId,
            sessionTitle
          );
          break;
        case 'resumed':
          await sessionRepository.markActive(harnessSessionId);
          break;
        case 'idle':
          await sessionRepository.markIdle(harnessSessionId);
          break;
        case 'closed':
          await sessionRepository.markClosed(harnessSessionId);
          break;
        case 'failed':
          await sessionRepository.markFailed(harnessSessionId);
          break;
      }
    },
  };
}
