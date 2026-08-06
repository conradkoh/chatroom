import type { InboundEvent } from '../entities/inbound-event.js';

export type EnhancerInboundEvent = Extract<InboundEvent, { type: 'enhancer.job-assigned' }>;

export type HandleEnhancerInboundDeps = {
  deliverInbound?: (event: EnhancerInboundEvent) => Promise<void>;
};

export async function handleEnhancerInbound(
  deps: HandleEnhancerInboundDeps,
  event: EnhancerInboundEvent
): Promise<void> {
  if (deps.deliverInbound) {
    await deps.deliverInbound(event);
  }
}
