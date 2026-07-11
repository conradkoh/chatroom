import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandoffDeps } from './deps.js';
import { syncGitAfterUserHandoff } from './sync-git-after-user-handoff.js';

vi.mock('../../infrastructure/machine/index.js', () => ({
  getMachineId: vi.fn().mockResolvedValue('machine-1'),
}));

vi.mock('../../infrastructure/git/git-reader.js', () => ({
  getBranch: vi.fn().mockResolvedValue({ status: 'available', branch: 'feat/x' }),
  isDirty: vi.fn().mockResolvedValue(true),
  getDiffStat: vi.fn().mockResolvedValue({
    status: 'available',
    diffStat: { filesChanged: 2, insertions: 10, deletions: 1 },
  }),
}));

function createDeps(overrides?: Partial<HandoffDeps>): HandoffDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn(),
    },
    session: {
      getSessionId: vi.fn().mockResolvedValue('session-1'),
      getConvexUrl: vi.fn().mockReturnValue('http://test:3210'),
      getOtherSessionUrls: vi.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
}

describe('syncGitAfterUserHandoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does nothing when handoff target is not user', async () => {
    const deps = createDeps();
    await syncGitAfterUserHandoff(deps, 'session-1', 'chatroom-1', 'builder');
    expect(deps.backend.query).not.toHaveBeenCalled();
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  it('requests git refresh when remote git state differs from local', async () => {
    const deps = createDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ machineId: 'machine-1', workingDir: process.cwd() }])
      .mockResolvedValueOnce({
        status: 'available',
        branch: 'main',
        isDirty: false,
        diffStat: { filesChanged: 0, insertions: 0, deletions: 0 },
      });

    await syncGitAfterUserHandoff(deps, 'session-1', 'chatroom-1', 'user');

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        machineId: 'machine-1',
        workingDir: process.cwd(),
      })
    );
  });

  it('skips refresh when remote git state matches local', async () => {
    const deps = createDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ machineId: 'machine-1', workingDir: process.cwd() }])
      .mockResolvedValueOnce({
        status: 'available',
        branch: 'feat/x',
        isDirty: true,
        diffStat: { filesChanged: 2, insertions: 10, deletions: 1 },
      });

    await syncGitAfterUserHandoff(deps, 'session-1', 'chatroom-1', 'user');

    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  it('requests git refresh when branch differs even if diffStat matches', async () => {
    const deps = createDeps();
    (deps.backend.query as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce([{ machineId: 'machine-1', workingDir: process.cwd() }])
      .mockResolvedValueOnce({
        status: 'available',
        branch: 'main',
        isDirty: true,
        diffStat: { filesChanged: 2, insertions: 10, deletions: 1 },
      });

    await syncGitAfterUserHandoff(deps, 'session-1', 'chatroom-1', 'user');

    expect(deps.backend.mutation).toHaveBeenCalled();
  });
});
