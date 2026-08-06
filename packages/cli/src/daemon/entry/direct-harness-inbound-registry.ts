import type { DirectHarnessInboundEvent } from '../domain/usecase/handle-direct-harness-inbound.js';

export type DirectHarnessInboundHandler = (event: DirectHarnessInboundEvent) => Promise<void>;

let handler: DirectHarnessInboundHandler | undefined;

export function registerDirectHarnessInboundHandler(h: DirectHarnessInboundHandler): void {
  handler = h;
}

export function unregisterDirectHarnessInboundHandler(): void {
  handler = undefined;
}

export async function dispatchDirectHarnessInboundEvent(
  event: DirectHarnessInboundEvent
): Promise<void> {
  if (handler) await handler(event);
}
