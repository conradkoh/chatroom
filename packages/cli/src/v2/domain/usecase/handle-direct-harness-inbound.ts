import type { InboundEvent } from '../entities/inbound-event.js';

export type DirectHarnessInboundEvent = Extract<
  InboundEvent,
  | { type: 'direct-harness.session-opened' }
  | { type: 'direct-harness.prompt' }
  | { type: 'direct-harness.command' }
>;

export type HandleDirectHarnessInboundDeps = {
  onDirectHarnessEvent?: (event: DirectHarnessInboundEvent) => Promise<void>;
};

export async function handleDirectHarnessInbound(
  deps: HandleDirectHarnessInboundDeps,
  event: DirectHarnessInboundEvent
): Promise<void> {
  if (deps.onDirectHarnessEvent) {
    await deps.onDirectHarnessEvent(event);
  }
}
