import type { DirectHarnessInboundEvent } from './handle-direct-harness-inbound.js';

export interface ProcessDirectHarnessInboundDeps {
  dispatchInbound: (event: DirectHarnessInboundEvent) => Promise<void>;
}

export async function processDirectHarnessInbound(
  deps: ProcessDirectHarnessInboundDeps,
  event: DirectHarnessInboundEvent
): Promise<void> {
  await deps.dispatchInbound(event);
}

/** @deprecated use processDirectHarnessInbound */
export const processDirectHarnessPrompt = processDirectHarnessInbound;
