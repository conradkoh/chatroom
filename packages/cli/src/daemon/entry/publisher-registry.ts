import type { OutboundEvent } from '../domain/entities/outbound-event.js';
import type { ConvexPublisherDeps } from '../infrastructure/convex/publishers/publisher-deps.js';
import type { PersistenceStore } from '../infrastructure/persistence/index.js';
import {
  createConvexPublishers,
  routeConvexEvent,
} from '../infrastructure/projection/convex/route-outbound-event.js';
import type { StreamHub } from '../local-web/server/stream-hub.js';

export type PublisherRegistryDeps = {
  persistence?: PersistenceStore;
  streamHub?: StreamHub;
  backend?: ConvexPublisherDeps['backend'];
  sessionId?: string;
  machineId?: string;
};

export type PublisherRegistry = {
  publish(event: OutboundEvent): Promise<void>;
};

export function createPublisherRegistry(deps: PublisherRegistryDeps = {}): PublisherRegistry {
  const convexDeps =
    deps.backend && deps.sessionId && deps.machineId
      ? {
          backend: deps.backend,
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        }
      : undefined;
  const publishers = convexDeps ? createConvexPublishers(convexDeps) : undefined;

  return {
    async publish(event) {
      deps.persistence?.append(event);
      if (event.type === 'harness.stream') {
        deps.streamHub?.publish(event);
        return;
      }

      if (!publishers) return;

      return routeConvexEvent(publishers, event);
    },
  };
}
