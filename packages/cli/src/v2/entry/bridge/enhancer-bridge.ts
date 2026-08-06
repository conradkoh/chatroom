import type { HandleEnhancerInboundDeps } from '../../domain/usecase/handle-enhancer-inbound.js';
import { processEnhancerJobInbound } from '../../domain/usecase/process-enhancer-job.js';
import { dispatchEnhancerInboundEvent } from '../enhancer-inbound-registry.js';

export function createEnhancerRouterDeps(): HandleEnhancerInboundDeps {
  return {
    deliverInbound: async (event) => {
      await processEnhancerJobInbound({ dispatchInbound: dispatchEnhancerInboundEvent }, event);
    },
  };
}
