import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertRegisteredWorkingDir } from './assert-registered-working-dir.js';
import { api } from '../../../api.js';
import type { DaemonSessionServiceShape } from '../../../daemon/entry/daemon-services.js';
import { createMockDaemonSessionInit } from '../../../daemon/entry/testing/index.js';
import { createMockDaemonDeps } from '../../../daemon/entry/testing/mock-daemon-deps.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaces: {
      listRecentlyObservedWorkspacesForMachine: 'mock-listRecentlyObservedWorkspacesForMachine',
    },
  },
}));

describe('assertRegisteredWorkingDir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches workspace when request path differs only by trailing slash', async () => {
    const deps = createMockDaemonDeps();
    const session = createMockDaemonSessionInit({
      backend: deps.backend,
      workspaceListStore: {
        workspaces: [{ workingDir: '/Users/alice/chatroom' }],
        updatedAt: Date.now(),
      },
    });

    const result = await assertRegisteredWorkingDir(
      session as unknown as DaemonSessionServiceShape,
      '/Users/alice/chatroom/'
    );

    expect(result).toEqual({ ok: true });
    expect(deps.backend.query).not.toHaveBeenCalled();
  });

  it('rejects when workspace is not registered', async () => {
    const deps = createMockDaemonDeps({
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue([]),
      },
    });
    const session = createMockDaemonSessionInit({
      backend: deps.backend,
      workspaceListStore: {
        workspaces: [{ workingDir: '/Users/alice/chatroom' }],
        updatedAt: Date.now(),
      },
    });

    const result = await assertRegisteredWorkingDir(
      session as unknown as DaemonSessionServiceShape,
      '/Users/alice/other'
    );

    expect(result).toEqual({ ok: false, error: 'Workspace not registered for this machine' });
    expect(deps.backend.query).toHaveBeenCalledTimes(1);
    expect(deps.backend.query).toHaveBeenCalledWith(
      api.workspaces.listRecentlyObservedWorkspacesForMachine,
      {
        sessionId: session.sessionId,
        machineId: session.machineId,
      }
    );
  });

  it('refreshes stale initialized cache and succeeds when backend has the workspace', async () => {
    const deps = createMockDaemonDeps({
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(['/Users/alice/chatroom']),
      },
    });
    const workspaceListStore = {
      workspaces: [] as { workingDir: string }[],
      updatedAt: Date.now(),
    };
    const session = createMockDaemonSessionInit({
      backend: deps.backend,
      workspaceListStore,
    });

    const result = await assertRegisteredWorkingDir(
      session as unknown as DaemonSessionServiceShape,
      '/Users/alice/chatroom'
    );

    expect(result).toEqual({ ok: true });
    expect(deps.backend.query).toHaveBeenCalledTimes(1);
    expect(deps.backend.query).toHaveBeenCalledWith(
      api.workspaces.listRecentlyObservedWorkspacesForMachine,
      {
        sessionId: session.sessionId,
        machineId: session.machineId,
      }
    );
    expect(workspaceListStore.workspaces).toEqual([{ workingDir: '/Users/alice/chatroom' }]);
    expect(workspaceListStore.updatedAt).toBeGreaterThan(0);

    const secondResult = await assertRegisteredWorkingDir(
      session as unknown as DaemonSessionServiceShape,
      '/Users/alice/chatroom'
    );

    expect(secondResult).toEqual({ ok: true });
    expect(deps.backend.query).toHaveBeenCalledTimes(1);
  });

  it('returns registration error after one refresh when backend still has no match', async () => {
    const deps = createMockDaemonDeps({
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(['/Users/alice/other']),
      },
    });
    const session = createMockDaemonSessionInit({
      backend: deps.backend,
      workspaceListStore: {
        workspaces: [],
        updatedAt: Date.now(),
      },
    });

    const result = await assertRegisteredWorkingDir(
      session as unknown as DaemonSessionServiceShape,
      '/Users/alice/chatroom'
    );

    expect(result).toEqual({ ok: false, error: 'Workspace not registered for this machine' });
    expect(deps.backend.query).toHaveBeenCalledTimes(1);
    expect(deps.backend.query).toHaveBeenCalledWith(
      api.workspaces.listRecentlyObservedWorkspacesForMachine,
      {
        sessionId: session.sessionId,
        machineId: session.machineId,
      }
    );
  });
});
