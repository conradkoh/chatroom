import type { CommandInboundEvent } from '../domain/usecase/handle-command-inbound.js';

export type CommandInboundHandler = (event: CommandInboundEvent) => Promise<void>;

let handler: CommandInboundHandler | undefined;

export function registerCommandInboundHandler(h: CommandInboundHandler): void {
  handler = h;
}

export function unregisterCommandInboundHandler(): void {
  handler = undefined;
}

export async function dispatchCommandInboundEvent(event: CommandInboundEvent): Promise<void> {
  if (handler) await handler(event);
}
