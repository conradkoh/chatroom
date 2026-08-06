import type { AgenticQueryInboundEvent } from './handle-agentic-query-inbound.js';

export interface ProcessAgenticQueryInboundDeps {
  dispatchInbound: (event: AgenticQueryInboundEvent) => Promise<void>;
}

export async function processAgenticQueryInbound(
  deps: ProcessAgenticQueryInboundDeps,
  event: AgenticQueryInboundEvent
): Promise<void> {
  await deps.dispatchInbound(event);
}

/** @deprecated use processAgenticQueryInbound */
export const processAgenticQueryPrompt = processAgenticQueryInbound;
