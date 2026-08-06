import { describe, expect, it, vi } from 'vitest';

import {
  fulfillFileContentRequest,
  type FulfillFileContentRequestDeps,
} from './fulfill-file-content-request.js';

describe('fulfillFileContentRequest', () => {
  it('dispatches file-content.request events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: FulfillFileContentRequestDeps = { dispatchInbound };
    const event = { type: 'file-content.request' as const, requestId: 'req_1' };

    await fulfillFileContentRequest(deps, event);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
