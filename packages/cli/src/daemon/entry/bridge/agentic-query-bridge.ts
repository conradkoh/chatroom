import type { HandleAgenticQueryInboundDeps } from '../../domain/usecase/handle-agentic-query-inbound.js';
import { processAgenticQueryInbound } from '../../domain/usecase/process-agentic-query-prompt.js';
import { dispatchAgenticQueryInboundEvent } from '../agentic-query-inbound-registry.js';

export function createAgenticQueryRouterDeps(): HandleAgenticQueryInboundDeps {
  return {
    deliverInbound: async (event) => {
      await processAgenticQueryInbound(
        { dispatchInbound: dispatchAgenticQueryInboundEvent },
        event
      );
    },
  };
}
