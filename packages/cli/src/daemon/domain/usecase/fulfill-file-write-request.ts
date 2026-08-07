import type { FileInboundEvent } from './handle-file-inbound.js';

export interface FulfillFileWriteRequestDeps {
  dispatchInbound: (
    event: Extract<FileInboundEvent, { type: 'file-write.request' }>
  ) => Promise<void>;
}

export async function fulfillFileWriteRequest(
  deps: FulfillFileWriteRequestDeps,
  event: Extract<FileInboundEvent, { type: 'file-write.request' }>
): Promise<void> {
  await deps.dispatchInbound(event);
}
