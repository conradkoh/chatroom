import type { OutboundEvent } from '../domain/entities/outbound-event.js';
import type { PersistenceStore } from '../infrastructure/persistence/index.js';

export type PublisherRegistryDeps = {
  persistence?: PersistenceStore;
};

export type PublisherRegistry = {
  publish(event: OutboundEvent): Promise<void>;
};

export function createPublisherRegistry(deps: PublisherRegistryDeps = {}): PublisherRegistry {
  return {
    async publish(event) {
      deps.persistence?.append(event);
      // Convex publisher routing remains stub — future slice
    },
  };
}
