import { ConvexError } from 'convex/values';
import type { Layer } from 'effect';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { WorkspaceFileTreeCoordinatorOptions } from '../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import { daemonSessionToLayers } from '../daemon-layers.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from '../daemon-services.js';
import type { DaemonSessionInit } from '../daemon-types.js';
import { createMockDaemonSessionInit } from '../testing/index.js';
import { createMockDaemonDeps } from '../testing/mock-daemon-deps.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      getPendingFileTreeRequests: 'pending',
      getFileTreeWatchLease: 'lease',
      getFileTreeCheckpoint: 'checkpoint',
      applyFileTreeDeltaBatch: 'delta',
      publishFileTreeCheckpoint: 'publish',
      syncFileTreeV2: 'sync-v2',
      syncFileTreeShardV3Batch: 'sync-v3-shards',
      syncFileTreeManifestV3: 'sync-v3-manifest',
      fulfillFileTreeRequest: 'fulfill',
      getPendingFileTreeReleaseRequests: 'pending-release',
      fulfillFileTreeReleaseRequest: 'fulfill-release',
    },
  },
}));

const coordinatorHandle = {
  workingDir: '/workspace',
  getManifest: vi.fn(),
  getTree: vi.fn(),
  checkpoint: vi.fn(async () => undefined),
  reconcile: vi.fn(async () => undefined),
  stop: vi.fn(async () => undefined),
};
const startCoordinator = vi.fn(
  async (_options: WorkspaceFileTreeCoordinatorOptions) => coordinatorHandle
);
const ACTIVE_LEASE = {
  watchCount: 1,
  expiresAt: Date.now() + 10 * 60 * 1000,
  leaseActive: true,
};

vi.mock('../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js', () => ({
  startWorkspaceFileTreeCoordinator: (options: WorkspaceFileTreeCoordinatorOptions) =>
    startCoordinator(options),
}));

vi.mock('../../../infrastructure/services/workspace/workspace-sync-queue.js', () => ({
  enqueueFileTreeSync: (_machineId: string, _workingDir: string, task: () => Promise<void>) =>
    task(),
}));

vi.mock('../../../infrastructure/services/workspace/file-tree-scanner.js', () => ({
  scanFileTree: vi.fn(async (rootDir: string) => ({
    entries: [{ path: 'src/index.ts', type: 'file' as const }],
    rootDir,
    scannedAt: 1,
  })),
}));

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
      const runtime = yield* Effect.runtime<DaemonSessionService>();
      const session = yield* DaemonSessionService;
      return yield* effect.pipe(
        Effect.provideService(DaemonSessionService, {
          ...session,
          runtime,
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
  it('starts one coordinator per normalized workspace and fulfills cached requests', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([
          { _id: 'one', workingDir: '/workspace/' },
          { _id: 'two', workingDir: '/workspace' },
        ]);
      }
      if (endpoint === 'checkpoint') {
        return Promise.resolve({
          revision: 0,
          strategyId: 'blob',
          snapshotId: 'hash',
        });
      }
      return Promise.resolve(null);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      machineId: 'machine-1',
      sessionId: 'session-1',
      backend: deps.backend,
    });

    await handle.drainPendingFileTreeRequests();

    await vi.waitFor(() => expect(startCoordinator).toHaveBeenCalledTimes(1));
    await vi.waitFor(() =>
      expect(deps.backend.mutation).toHaveBeenCalledWith(
        'fulfill',
        expect.objectContaining({ workingDir: '/workspace' })
      )
    );
  });

  it('runs reconciliation only for explicit recovery requests', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'force', workingDir: '/workspace', force: true }]);
      }
      if (endpoint === 'checkpoint') {
        return Promise.resolve({ revision: 0 });
      }
      return Promise.resolve(null);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
    });

    await handle.drainPendingFileTreeRequests();

    await vi.waitFor(() => expect(coordinatorHandle.reconcile).toHaveBeenCalledTimes(1));
  });

  it('runs a one-shot sync without starting a coordinator when the lease is inactive', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'cold', workingDir: '/workspace' }]);
      }
      if (endpoint === 'lease') {
        return Promise.resolve({ watchCount: 0, expiresAt: null, leaseActive: false });
      }
      return Promise.resolve(null);
    });
    vi.mocked(deps.backend.mutation).mockResolvedValue({
      status: 'published',
      revision: 0,
      prunedDeltaCount: 0,
      pruneComplete: true,
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
    });

    await handle.drainPendingFileTreeRequests();

    expect(startCoordinator).not.toHaveBeenCalled();
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'publish',
      expect.objectContaining({ workingDir: '/workspace', revision: 0 })
    );
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'fulfill',
      expect.objectContaining({ workingDir: '/workspace' })
    );
  });

  it('stops a cold sync without fulfilling its request when sync is disabled', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'cold-disabled', workingDir: '/workspace' }]);
      }
      if (endpoint === 'lease') {
        return Promise.resolve({ watchCount: 0, expiresAt: null, leaseActive: false });
      }
      return Promise.resolve(null);
    });
    vi.mocked(deps.backend.mutation).mockImplementation((endpoint: string) => {
      if (endpoint === 'publish' || endpoint === 'sync-v2') {
        return Promise.reject(
          new ConvexError({ code: 'FILE_TREE_SYNC_DISABLED', message: 'disabled' })
        );
      }
      return Promise.resolve(undefined);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
    });

    await expect(handle.drainPendingFileTreeRequests()).resolves.toBeUndefined();

    expect(startCoordinator).not.toHaveBeenCalled();
    expect(deps.backend.mutation).not.toHaveBeenCalledWith('fulfill', expect.anything());
  });

  it('stops an active coordinator when a delta send is disabled', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'active-disabled', workingDir: '/workspace' }]);
      }
      if (endpoint === 'checkpoint') return Promise.resolve({ revision: 0 });
      return Promise.resolve(null);
    });
    vi.mocked(deps.backend.mutation).mockImplementation((endpoint: string) => {
      if (endpoint === 'delta') {
        return Promise.reject(
          new ConvexError({ code: 'FILE_TREE_SYNC_DISABLED', message: 'disabled' })
        );
      }
      return Promise.resolve({ status: 'applied', revision: 1 });
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
    });

    await handle.drainPendingFileTreeRequests();
    await vi.waitFor(() => expect(startCoordinator).toHaveBeenCalled());
    const options = startCoordinator.mock.calls[0]![0];

    await expect(
      options.onDelta(
        {
          operationId: 'disabled-operation',
          added: [{ path: 'new.ts', type: 'file' }],
          removed: [],
          typeChanged: [],
          createdAt: 1,
        },
        0
      )
    ).resolves.toEqual({ status: 'applied', revision: 0 });
    await vi.waitFor(() => expect(coordinatorHandle.stop).toHaveBeenCalled());
  });

  it('maps cached path changes to revisioned backend operations', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'one', workingDir: '/workspace' }]);
      }
      if (endpoint === 'checkpoint') {
        return Promise.resolve({ revision: 0 });
      }
      return Promise.resolve(null);
    });
    vi.mocked(deps.backend.mutation).mockResolvedValue({ status: 'applied', revision: 4 });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
    });

    await handle.drainPendingFileTreeRequests();
    await vi.waitFor(() => expect(startCoordinator).toHaveBeenCalled());
    const options = startCoordinator.mock.calls[0]![0];

    const result = await options.onDelta(
      {
        operationId: 'operation-1',
        added: [{ path: 'new.ts', type: 'file' }],
        removed: ['old.ts'],
        typeChanged: [{ path: 'src', type: 'directory' }],
        createdAt: 1,
      },
      3
    );

    expect(result).toEqual({ status: 'applied', revision: 4 });
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'delta',
      expect.objectContaining({
        operationId: 'operation-1',
        baseRevision: 3,
        operations: [
          { o: 'a', p: 'new.ts', e: 'f' },
          { o: 'r', p: 'old.ts' },
          { o: 't', p: 'src', e: 'd' },
        ],
      })
    );
  });

  it('routes workspace file-tree checkpoint publishing through its outbox', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'one', workingDir: '/workspace' }]);
      }
      if (endpoint === 'checkpoint') {
        return Promise.resolve({ revision: 1 });
      }
      return Promise.resolve(null);
    });
    vi.mocked(deps.backend.mutation).mockResolvedValue({
      status: 'published',
      revision: 7,
      prunedDeltaCount: 0,
      pruneComplete: true,
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
    });

    await handle.drainPendingFileTreeRequests();
    await vi.waitFor(() => expect(startCoordinator).toHaveBeenCalled());
    const options = startCoordinator.mock.calls[0]![0];
    const tree = {
      entries: [{ path: 'src/index.ts', type: 'file' as const }],
      rootDir: '/workspace',
      scannedAt: 1,
    };

    await expect(options.onCheckpoint(tree, 7)).resolves.toEqual({ revision: 7 });
    expect(deps.backend.mutation).toHaveBeenCalledWith('sync-v2', expect.anything());
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'publish',
      expect.objectContaining({ revision: 7, strategyId: 'blob' })
    );

    handle.stop();
  });

  it('stops all workspace coordinators with the subscription', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'one', workingDir: '/workspace' }]);
      }
      if (endpoint === 'checkpoint') {
        return Promise.resolve({ revision: 0 });
      }
      return Promise.resolve(null);
    });
    const handle = await runWithSession(startFileTreeSubscriptionEffect(), {
      backend: deps.backend,
    });

    await handle.drainPendingFileTreeRequests();
    await vi.waitFor(() => expect(startCoordinator).toHaveBeenCalled());

    handle.stop();

    await vi.waitFor(() => expect(coordinatorHandle.stop).toHaveBeenCalled());
  });

  it('stops coordinator when a release request is drained', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    let releaseQueryCount = 0;
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'lease') return Promise.resolve(ACTIVE_LEASE);
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'one', workingDir: '/workspace' }]);
      }
      if (endpoint === 'checkpoint') {
        return Promise.resolve({ revision: 0 });
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
    });

    await handle.drainPendingFileTreeRequests();
    await vi.waitFor(() => expect(startCoordinator).toHaveBeenCalled());

    await handle.drainPendingFileTreeReleaseRequests();

    await vi.waitFor(() => expect(coordinatorHandle.stop).toHaveBeenCalled());
    expect(deps.backend.mutation).toHaveBeenCalledWith('fulfill-release', expect.any(Object));

    vi.mocked(startCoordinator).mockClear();
    await handle.drainPendingFileTreeRequests();
    await vi.waitFor(() => expect(startCoordinator).toHaveBeenCalledTimes(1));
  });

  it('drains all bounded batches until the release queue is empty', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
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
    });

    await handle.drainPendingFileTreeReleaseRequests();

    expect(releaseQueryCount).toBe(1);
  });
});
