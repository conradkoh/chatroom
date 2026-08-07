import type { InboundEvent } from '../entities/inbound-event.js';

export type AgenticQueryInboundEvent = Extract<
  InboundEvent,
  { type: 'agentic-query.session-opened' } | { type: 'agentic-query.prompt' }
>;

export type HandleAgenticQueryInboundDeps = {
  deliverInbound?: (event: AgenticQueryInboundEvent) => Promise<void>;
};

export async function handleAgenticQueryInbound(
  deps: HandleAgenticQueryInboundDeps,
  event: AgenticQueryInboundEvent
): Promise<void> {
  if (deps.deliverInbound) {
    await deps.deliverInbound(event);
  }
}
