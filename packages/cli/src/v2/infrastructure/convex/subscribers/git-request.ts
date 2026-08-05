import type { InboundEvent } from '../../../domain/entities/inbound-event.js';

export type SubscriberHandle = { stop(): void };

export function startGitRequestSubscriber(
  _deps: unknown,
  _onEvent: (event: InboundEvent) => void
): SubscriberHandle {
  return { stop() {} };
}
