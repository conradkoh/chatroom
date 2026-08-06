import type { InboundEvent } from '../entities/inbound-event.js';

export type FileInboundEvent = Extract<
  InboundEvent,
  { type: 'file-tree.request' } | { type: 'file-content.request' } | { type: 'file-write.request' }
>;

export type HandleFileInboundDeps = {
  onFileEvent?: (event: FileInboundEvent) => Promise<void>;
};

export async function handleFileInbound(
  deps: HandleFileInboundDeps,
  event: FileInboundEvent
): Promise<void> {
  if (deps.onFileEvent) {
    await deps.onFileEvent(event);
  }
}
