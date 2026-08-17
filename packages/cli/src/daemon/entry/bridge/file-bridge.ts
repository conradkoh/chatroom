import { fulfillFileContentRequest } from '../../domain/usecase/fulfill-file-content-request.js';
import { fulfillFileTreeRequest } from '../../domain/usecase/fulfill-file-tree-request.js';
import { fulfillFileWriteRequest } from '../../domain/usecase/fulfill-file-write-request.js';
import type { HandleFileInboundDeps } from '../../domain/usecase/handle-file-inbound.js';
import { dispatchFileInboundEvent } from '../file-inbound-registry.js';

export function createFileRouterDeps(): HandleFileInboundDeps {
  return {
    // fallow-ignore-next-line complexity
    deliverInbound: async (event) => {
      switch (event.type) {
        case 'file-tree.request':
        case 'file-tree.release':
          await fulfillFileTreeRequest({ dispatchInbound: dispatchFileInboundEvent }, event);
          break;
        case 'file-content.request':
          await fulfillFileContentRequest({ dispatchInbound: dispatchFileInboundEvent }, event);
          break;
        case 'file-write.request':
          await fulfillFileWriteRequest({ dispatchInbound: dispatchFileInboundEvent }, event);
          break;
      }
    },
  };
}
