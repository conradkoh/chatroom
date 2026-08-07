import type { ConvexPublisherDeps } from './publisher-deps.js';
import type { Publisher } from './publisher.js';
import { ConvexCapabilitiesPublisher } from '../../../../infrastructure/repos/convex-capabilities-publisher.js';
import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export function createCapabilitiesPublisher(deps: ConvexPublisherDeps): Publisher {
  const capabilitiesPublisher = new ConvexCapabilitiesPublisher({
    backend: deps.backend,
    sessionId: deps.sessionId,
  });

  return {
    async publish(event: OutboundEvent): Promise<void> {
      if (event.type !== 'capabilities.updated') return;
      await capabilitiesPublisher.publish(event.capabilities);
    },
  };
}
