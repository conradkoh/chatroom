import type { InboundEvent } from '../domain/entities/inbound-event.js';

export type EventRouterDeps = Record<string, never>;

export async function routeInboundEvent(
  _deps: EventRouterDeps,
  event: InboundEvent
): Promise<void> {
  switch (event.type) {
    default:
      // TODO: dispatch to use cases per event.type
      void event;
  }
}
