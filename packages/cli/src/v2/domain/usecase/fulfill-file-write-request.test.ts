import { describe, expect, it, vi } from 'vitest';

import {
  fulfillFileWriteRequest,
  type FulfillFileWriteRequestDeps,
} from './fulfill-file-write-request.js';

describe('fulfillFileWriteRequest', () => {
  it('dispatches file-write.request events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: FulfillFileWriteRequestDeps = { dispatchInbound };
    const event = { type: 'file-write.request' as const, requestId: 'req_1' };

    await fulfillFileWriteRequest(deps, event);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
