import { ConvexError } from 'convex/values';
import type { Layer } from 'effect';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceFileTreeCoordinator } from '../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import type { WorkspaceService } from '../../services/workspace-service/index.js';
import { daemonSessionToLayers } from '../daemon-layers.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../daemon-services.js';
import type { DaemonSessionInit } from '../daemon-types.js';
import { createMockDaemonSessionInit } from '../testing/index.js';
import { createFakeWorkspaceService } from '../testing/mock-daemon-context.js';
import { createMockDaemonDeps } from '../testing/mock-daemon-deps.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      getPendingFileTreeRequests: 'pending',
      getFileTreeWatchLease: 'lease',
      fulfillFileTreeRequest: 'fulfill',
      getPendingFileTreeReleaseRequests: 'pending-release',
      fulfillFileTreeReleaseRequest: 'fulfill-release',
    },
  },
}));

vi.mock('../../../infrastructure/services/workspace/workspace-sync-queue.js', () => ({
  enqueueFileTreeSync: (_machineId: string, _workingDir: string, task: () => Promise<void>) =>
    task(),
}));

const ACTIVE_LEASE = {
  watchCount: 1,
  expiresAt: Date.now() + 10 * 60 * 1000,
  leaseActive: true,
};

type FakeFileTree = WorkspaceService['fileTree'] & {
  ensure: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  disable: ReturnType<typeof vi.fn>;
  oneShot: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
};

/** Stands in for the service-owned host. The adapter only decides which call a request needs. */
function createFakeFileTree(): FakeFileTree {
  return {
    ensure: vi.fn(async () => undefined as unknown as WorkspaceFileTreeCoordinator),
    stop: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    oneShot: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => undefined),
  };
}

function makeSessionLayer(
  overrides?: Partial<DaemonSessionInit>
): Layer.Layer<DaemonSessionService> {
  return daemonSessionToLayers(createMockDaemonSessionInit(overrides));
}

async function runWithSession<A>(
  effect: Effect.Effect<A, never, DaemonSessionService>,
  overrides?: Partial<DaemonSessionInit>
) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const effectContext = yield* Effect.context<DaemonSessionService>();
      const session = yield* DaemonSessionService;
      return yield* effect.pipe(
        Effect.provideService(DaemonSessionService, {
          ...session,
          effectContext,
        } as DaemonSessionServiceShape)
      );
    }).pipe(Effect.provide(makeSessionLayer(overrides)))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('startFileTreeSubscriptionEffect', () => {
  it('ensures one coordinator per normalized workspace and fulfils the request', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    const fileTree = createFakeFileTree();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([
          { _id: 'one', workingDir: '/workspace/' },
          { _id: 'two', workingDir: '/workspace' },
        ]);
      }
      return Promise.resolve(null);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      machineId: 'machine-1',
      sessionId: 'session-1',
      backend: deps.backend,
      workspaceService: createFakeWorkspaceService({ fileTree }),
    });

    await handle.drainPendingFileTreeRequests();

    expect(fileTree.ensure).toHaveBeenCalledTimes(1);
    expect(fileTree.ensure).toHaveBeenCalledWith('/workspace', { forceReconcile: false });
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'fulfill',
      expect.objectContaining({ workingDir: '/workspace' })
    );
  });

  it('requests reconciliation only for explicit recovery requests', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    const fileTree = createFakeFileTree();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'force', workingDir: '/workspace', force: true }]);
      }
      return Promise.resolve(null);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
      workspaceService: createFakeWorkspaceService({ fileTree }),
    });

    await handle.drainPendingFileTreeRequests();

    expect(fileTree.ensure).toHaveBeenCalledWith('/workspace', { forceReconcile: true });
  });

  it('runs a one-shot sync without ensuring a coordinator when the lease is inactive', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    const fileTree = createFakeFileTree();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'cold', workingDir: '/workspace' }]);
      }
      if (endpoint === 'lease') {
        return Promise.resolve({ watchCount: 0, expiresAt: null, leaseActive: false });
      }
      return Promise.resolve(null);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
      workspaceService: createFakeWorkspaceService({ fileTree }),
    });

    await handle.drainPendingFileTreeRequests();

    expect(fileTree.ensure).not.toHaveBeenCalled();
    expect(fileTree.stop).toHaveBeenCalledWith('/workspace');
    expect(fileTree.oneShot).toHaveBeenCalledWith('/workspace');
    // The host's one-shot path fulfils the request itself, so the adapter does not.
    expect(deps.backend.mutation).not.toHaveBeenCalledWith('fulfill', expect.anything());
  });

  it('disables the directory when the request hits a sync-disabled error', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    const fileTree = createFakeFileTree();
    fileTree.ensure.mockRejectedValue(
      new ConvexError({ code: 'FILE_TREE_SYNC_DISABLED', message: 'disabled' })
    );
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'active-disabled', workingDir: '/workspace' }]);
      }
      return Promise.resolve(null);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
      workspaceService: createFakeWorkspaceService({ fileTree }),
    });

    await expect(handle.drainPendingFileTreeRequests()).resolves.toBeUndefined();

    expect(fileTree.disable).toHaveBeenCalledWith('/workspace');
    expect(deps.backend.mutation).not.toHaveBeenCalledWith('fulfill', expect.anything());
  });

  it('stops the coordinator when the lease is no longer active after fulfilling', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    const fileTree = createFakeFileTree();
    let leaseQueryCount = 0;
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') {
        leaseQueryCount++;
        return Promise.resolve(
          leaseQueryCount === 1
            ? ACTIVE_LEASE
            : { watchCount: 0, expiresAt: null, leaseActive: false }
        );
      }
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'expired', workingDir: '/workspace' }]);
      }
      return Promise.resolve(null);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
      workspaceService: createFakeWorkspaceService({ fileTree }),
    });

    await handle.drainPendingFileTreeRequests();

    expect(fileTree.ensure).toHaveBeenCalledWith('/workspace', { forceReconcile: false });
    expect(fileTree.stop).toHaveBeenCalledWith('/workspace');
  });

  it('disables a directory when its release request is drained', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    const fileTree = createFakeFileTree();
    let releaseQueryCount = 0;
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'one', workingDir: '/workspace' }]);
      }
      if (endpoint === 'pending-release') {
        releaseQueryCount++;
        return Promise.resolve(
          releaseQueryCount === 1 ? [{ _id: 'release-1', workingDir: '/workspace' }] : []
        );
      }
      return Promise.resolve(null);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
      workspaceService: createFakeWorkspaceService({ fileTree }),
    });

    await handle.drainPendingFileTreeRequests();
    expect(fileTree.ensure).toHaveBeenCalledTimes(1);

    await handle.drainPendingFileTreeReleaseRequests();

    expect(fileTree.disable).toHaveBeenCalledWith('/workspace');
    expect(deps.backend.mutation).toHaveBeenCalledWith('fulfill-release', expect.any(Object));

    await handle.drainPendingFileTreeRequests();
    expect(fileTree.ensure).toHaveBeenCalledTimes(2);
  });

  it('drains all bounded batches until the release queue is empty', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    const fileTree = createFakeFileTree();
    let releaseQueryCount = 0;
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint !== 'pending-release') return Promise.resolve(null);
      releaseQueryCount++;
      if (releaseQueryCount === 1) {
        return Promise.resolve(
          Array.from({ length: 50 }, (_, index) => ({
            _id: `release-${index}`,
            workingDir: `/workspace/${index}`,
          }))
        );
      }
      if (releaseQueryCount === 2) {
        return Promise.resolve([{ _id: 'release-last', workingDir: '/workspace/last' }]);
      }
      return Promise.resolve([]);
    });

    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
      workspaceService: createFakeWorkspaceService({ fileTree }),
    });

    await handle.drainPendingFileTreeReleaseRequests();

    expect(releaseQueryCount).toBe(3);
    expect(
      vi
        .mocked(deps.backend.mutation)
        .mock.calls.filter(([endpoint]) => endpoint === 'fulfill-release')
    ).toHaveLength(51);
  });

  it('stops draining when no release can be fulfilled', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    const fileTree = createFakeFileTree();
    let releaseQueryCount = 0;
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'pending-release') {
        releaseQueryCount++;
        return Promise.resolve([{ _id: 'release-failing', workingDir: '/workspace' }]);
      }
      return Promise.resolve(null);
    });
    vi.mocked(deps.backend.mutation).mockImplementation((endpoint: string) => {
      if (endpoint === 'fulfill-release') return Promise.reject(new Error('fulfill failed'));
      return Promise.resolve(undefined);
    });

    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
      workspaceService: createFakeWorkspaceService({ fileTree }),
    });

    await handle.drainPendingFileTreeReleaseRequests();

    expect(releaseQueryCount).toBe(1);
  });
});
