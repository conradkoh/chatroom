import type { AgenticQueryInboundEvent } from '../domain/usecase/handle-agentic-query-inbound.js';

export type AgenticQueryInboundHandler = (event: AgenticQueryInboundEvent) => Promise<void>;

let handler: AgenticQueryInboundHandler | undefined;

export function registerAgenticQueryInboundHandler(h: AgenticQueryInboundHandler): void {
  handler = h;
}

export function unregisterAgenticQueryInboundHandler(): void {
  handler = undefined;
}

export async function dispatchAgenticQueryInboundEvent(
  event: AgenticQueryInboundEvent
): Promise<void> {
  if (handler) await handler(event);
}
