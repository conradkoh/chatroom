import type { EnhancerInboundEvent } from '../domain/usecase/handle-enhancer-inbound.js';

export type EnhancerInboundHandler = (event: EnhancerInboundEvent) => Promise<void>;

let handler: EnhancerInboundHandler | undefined;

export function registerEnhancerInboundHandler(h: EnhancerInboundHandler): void {
  handler = h;
}

export function unregisterEnhancerInboundHandler(): void {
  handler = undefined;
}

export async function dispatchEnhancerInboundEvent(event: EnhancerInboundEvent): Promise<void> {
  if (handler) await handler(event);
}
