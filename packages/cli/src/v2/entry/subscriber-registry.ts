import type { InboundEvent } from '../domain/entities/inbound-event.js';

export type SubscriberRegistryHandle = { stopAll(): void };

export function startAllSubscribers(
  _deps: unknown,
  _onEvent: (event: InboundEvent) => void
): SubscriberRegistryHandle {
  return { stopAll() {} };
}
