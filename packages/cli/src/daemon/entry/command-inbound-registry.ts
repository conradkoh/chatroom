import type { CommandInboundEvent } from '../domain/usecase/handle-command-inbound.js';
import type { MachineCommandReadiness } from '../infrastructure/convex/subscribers/machine-command-inbox.js';

export type CommandInboundHandler = (event: CommandInboundEvent) => Promise<void>;

/*
 * The daemon registers its command handler last in startup and clears it on shutdown.
 * Machine commands are claimed only while a handler is registered: an acknowledged claim is
 * deleted, so a claim taken before the handler exists would be consumed without running anything.
 */
let handler: CommandInboundHandler | undefined;
const readyListeners = new Set<() => void>();

export function registerCommandInboundHandler(h: CommandInboundHandler): void {
  handler = h;
  for (const listener of [...readyListeners]) listener();
}

export function unregisterCommandInboundHandler(): void {
  handler = undefined;
}

/** Readiness is the handler registration, so it cannot drift from what dispatch can run. */
export const commandInboundReadiness: MachineCommandReadiness = {
  isReady: () => handler !== undefined,
  onReady(listener) {
    readyListeners.add(listener);
    return () => {
      readyListeners.delete(listener);
    };
  },
};

export async function dispatchCommandInboundEvent(event: CommandInboundEvent): Promise<void> {
  if (handler) await handler(event);
}
