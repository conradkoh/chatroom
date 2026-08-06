import { describe, expect, it, vi } from 'vitest';

import { syncGitState, type SyncGitStateDeps } from './sync-git-state.js';

describe('syncGitState', () => {
  it('dispatches workspace.list-changed events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: SyncGitStateDeps = { dispatchInbound };
    const event = { type: 'workspace.list-changed' as const, machineId: 'machine_1' };

    await syncGitState(deps, event);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
