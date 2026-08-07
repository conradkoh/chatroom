import { handleCommandEvent } from '../../domain/usecase/handle-command-event.js';
import type { HandleCommandInboundDeps } from '../../domain/usecase/handle-command-inbound.js';
import { dispatchCommandInboundEvent } from '../command-inbound-registry.js';

export function createCommandRouterDeps(): HandleCommandInboundDeps {
  return {
    deliverInbound: async (event) => {
      await handleCommandEvent({ dispatchInbound: dispatchCommandInboundEvent }, event);
    },
  };
}
