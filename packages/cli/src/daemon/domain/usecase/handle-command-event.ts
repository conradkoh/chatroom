import type { CommandInboundEvent } from './handle-command-inbound.js';

export interface HandleCommandEventDeps {
  dispatchInbound: (event: CommandInboundEvent) => Promise<void>;
}

export async function handleCommandEvent(
  deps: HandleCommandEventDeps,
  event: CommandInboundEvent
): Promise<void> {
  await deps.dispatchInbound(event);
}
