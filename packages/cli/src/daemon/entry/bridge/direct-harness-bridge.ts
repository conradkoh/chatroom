import type { HandleDirectHarnessInboundDeps } from '../../domain/usecase/handle-direct-harness-inbound.js';
import { processDirectHarnessInbound } from '../../domain/usecase/process-direct-harness-prompt.js';
import { dispatchDirectHarnessInboundEvent } from '../direct-harness-inbound-registry.js';

export function createDirectHarnessRouterDeps(): HandleDirectHarnessInboundDeps {
  return {
    deliverInbound: async (event) => {
      await processDirectHarnessInbound(
        { dispatchInbound: dispatchDirectHarnessInboundEvent },
        event
      );
    },
  };
}
