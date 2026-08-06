import type { InboundEvent } from '../entities/inbound-event.js';

export type CommandInboundEvent = Extract<
  InboundEvent,
  { type: 'command.received' } | { type: 'command-run.updated' }
>;

export type HandleCommandInboundDeps = {
  deliverInbound?: (event: CommandInboundEvent) => Promise<void>;
};

export async function handleCommandInbound(
  deps: HandleCommandInboundDeps,
  event: CommandInboundEvent
): Promise<void> {
  if (deps.deliverInbound) {
    await deps.deliverInbound(event);
  }
}
