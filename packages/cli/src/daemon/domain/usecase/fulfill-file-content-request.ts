import type { FileInboundEvent } from './handle-file-inbound.js';

export interface FulfillFileContentRequestDeps {
  dispatchInbound: (
    event: Extract<FileInboundEvent, { type: 'file-content.request' }>
  ) => Promise<void>;
}

export async function fulfillFileContentRequest(
  deps: FulfillFileContentRequestDeps,
  event: Extract<FileInboundEvent, { type: 'file-content.request' }>
): Promise<void> {
  await deps.dispatchInbound(event);
}
