import type { OutboundEvent } from '../../domain/entities/outbound-event.js';

export type HarnessStreamEvent = Extract<OutboundEvent, { type: 'harness.stream' }>;

export type StreamHub = {
  publish(event: HarnessStreamEvent): void;
  subscribe(listener: (event: HarnessStreamEvent) => void): () => void;
};

export function createStreamHub(): StreamHub {
  const listeners = new Set<(event: HarnessStreamEvent) => void>();
  return {
    publish(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
