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

vi.mock('../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js', () => ({
  startWorkspaceFileTreeCoordinator: (options: WorkspaceFileTreeCoordinatorOptions) =>
    startCoordinator(options),
}));

vi.mock('../../../infrastructure/services/workspace/workspace-sync-queue.js', () => ({
  enqueueFileTreeSync: (_machineId: string, _workingDir: string, task: () => Promise<void>) =>
    task(),
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

  it('maps cached path changes to revisioned backend operations', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
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
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'pending') {
        return Promise.resolve([{ _id: 'one', workingDir: '/workspace' }]);
      }
      if (endpoint === 'checkpoint') {
        return Promise.resolve({ revision: 0 });
      }
      if (endpoint === 'pending-release') {
        return Promise.resolve([{ _id: 'release-1', workingDir: '/workspace' }]);
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
});
