import type { FileInboundEvent } from '../domain/usecase/handle-file-inbound.js';

export type FileInboundHandler = (event: FileInboundEvent) => Promise<void>;

let handler: FileInboundHandler | undefined;

export function registerFileInboundHandler(h: FileInboundHandler): void {
  handler = h;
}

export function unregisterFileInboundHandler(): void {
  handler = undefined;
}

export async function dispatchFileInboundEvent(event: FileInboundEvent): Promise<void> {
  if (handler) await handler(event);
}
