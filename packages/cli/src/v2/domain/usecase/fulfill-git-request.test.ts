import { describe, expect, it, vi } from 'vitest';

import { fulfillGitRequest, type FulfillGitRequestDeps } from './fulfill-git-request.js';

describe('fulfillGitRequest', () => {
  it('dispatches git.request events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: FulfillGitRequestDeps = { dispatchInbound };
    const event = { type: 'git.request' as const, requestId: 'req_1' };

    await fulfillGitRequest(deps, event);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
