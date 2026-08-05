import type { OutboundEvent } from '../domain/entities/outbound-event.js';

export type PublisherRegistry = {
  publish(event: OutboundEvent): Promise<void>;
};

export function createPublisherRegistry(_deps: unknown): PublisherRegistry {
  return {
    async publish(_event: OutboundEvent): Promise<void> {
      // TODO: route to convex/publishers/
    },
  };
}
