import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';

export type Publisher = {
  publish(event: OutboundEvent): Promise<void>;
};

export function createTurnOutputPublisher(_deps: unknown): Publisher {
  return {
    async publish(_event: OutboundEvent): Promise<void> {
      // TODO: migrate from legacy
    },
  };
}
