import { describe, expect, it, vi } from 'vitest';

import { createGitStatePublisher } from './git-state.js';

describe('createGitStatePublisher', () => {
  it('calls upsertWorkspaceGitState with workingDir and payload', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createGitStatePublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    await publisher.publish({
      type: 'git.state',
      workingDir: '/repo',
      payload: { status: 'available', branch: 'main' },
    });

    expect(mutation).toHaveBeenCalledWith(expect.anything(), {
      sessionId: 'sess-1',
      machineId: 'machine-1',
      workingDir: '/repo',
      status: 'available',
      branch: 'main',
    });
  });
});
