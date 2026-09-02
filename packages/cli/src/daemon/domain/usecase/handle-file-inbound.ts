import type { InboundEvent } from '../entities/inbound-event.js';

export type FileInboundEvent = Extract<
  InboundEvent,
  | { type: 'file-tree.request' }
  | { type: 'file-tree.release' }
  | { type: 'file-content.request' }
  | { type: 'file-write.request' }
>;

export type HandleFileInboundDeps = {
  deliverInbound?:( (event: FileInboundEvent) => Promise<void>) | undefined;
};

export async function handleFileInbound(
  deps: HandleFileInboundDeps,
  event: FileInboundEvent
): Promise<void> {
  if (deps.deliverInbound) {
    await deps.deliverInbound(event);
  }
}
