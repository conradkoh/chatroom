import { describe, expect, it, vi } from 'vitest';

import {
  fulfillFileTreeRequest,
  type FulfillFileTreeRequestDeps,
} from './fulfill-file-tree-request.js';

describe('fulfillFileTreeRequest', () => {
  it('dispatches file-tree.request events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: FulfillFileTreeRequestDeps = { dispatchInbound };
    const event = { type: 'file-tree.request' as const, requestId: 'req_1' };

    await fulfillFileTreeRequest(deps, event);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
