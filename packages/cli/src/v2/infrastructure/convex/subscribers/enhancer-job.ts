import type { InboundEvent } from '../../../domain/entities/inbound-event.js';

export type SubscriberHandle = { stop(): void };

export function startEnhancerJobSubscriber(
  _deps: unknown,
  _onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  return { stop() {} };
}
