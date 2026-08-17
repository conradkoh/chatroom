import type { FileInboundEvent } from './handle-file-inbound.js';

export interface FulfillFileTreeRequestDeps {
  dispatchInbound: (
    event: Extract<FileInboundEvent, { type: 'file-tree.request' | 'file-tree.release' }>
  ) => Promise<void>;
}

export async function fulfillFileTreeRequest(
  deps: FulfillFileTreeRequestDeps,
  event: Extract<FileInboundEvent, { type: 'file-tree.request' | 'file-tree.release' }>
): Promise<void> {
  await deps.dispatchInbound(event);
}
