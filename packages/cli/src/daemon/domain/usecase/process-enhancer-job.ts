import type { EnhancerInboundEvent } from './handle-enhancer-inbound.js';

export interface ProcessEnhancerJobDeps {
  dispatchInbound: (event: EnhancerInboundEvent) => Promise<void>;
}

export async function processEnhancerJobInbound(
  deps: ProcessEnhancerJobDeps,
  event: EnhancerInboundEvent
): Promise<void> {
  await deps.dispatchInbound(event);
}
