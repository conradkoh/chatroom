import { ConvexError } from 'convex/values';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWorkspaceFileTreeHost } from './workspace-file-tree-host.js';
import type { WorkspaceFileTreeCoordinatorOptions } from '../../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';
import { createMockDaemonDeps } from '../../../entry/testing/mock-daemon-deps.js';

vi.mock('../../../../api.js', () => ({
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

vi.mock('../../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js', () => ({
  startWorkspaceFileTreeCoordinator: (options: WorkspaceFileTreeCoordinatorOptions) =>
    startCoordinator(options),
}));

vi.mock('../../../../infrastructure/services/workspace/file-tree-scanner.js', () => ({
  scanFileTree: vi.fn(async (rootDir: string) => ({
    entries: [{ path: 'src/index.ts', type: 'file' as const }],
    rootDir,
    scannedAt: 1,
  })),
}));

function createHost(
  backend: ReturnType<typeof createMockDaemonDeps>['backend'],
  getRootSnapshotReader: Parameters<
    typeof createWorkspaceFileTreeHost
  >[0]['getRootSnapshotReader'] = async () => undefined
) {
  return createWorkspaceFileTreeHost({
    session: { sessionId: 'session-1', machineId: 'machine-1', backend },
    getRootSnapshotReader,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('createWorkspaceFileTreeHost', () => {
  it('starts one coordinator per normalized workspace', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'checkpoint') return Promise.resolve({ revision: 0 });
      return Promise.resolve(null);
    });
    const host = createHost(deps.backend);

    await host.ensure('/workspace/', { forceReconcile: false });
    await host.ensure('/workspace', { forceReconcile: false });

    expect(startCoordinator).toHaveBeenCalledTimes(1);
    expect(startCoordinator.mock.calls[0]![0].workingDir).toBe('/workspace');
  });

  it('runs reconciliation only for explicit recovery requests', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'checkpoint') return Promise.resolve({ revision: 0 });
      return Promise.resolve(null);
    });
    const host = createHost(deps.backend);

    await host.ensure('/workspace', { forceReconcile: false });
    expect(coordinatorHandle.reconcile).not.toHaveBeenCalled();

    await host.ensure('/workspace', { forceReconcile: true });
    expect(coordinatorHandle.reconcile).toHaveBeenCalledTimes(1);
  });

  it('runs a one-shot sync without starting a coordinator', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
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
    const host = createHost(deps.backend);

    await host.oneShot('/workspace');

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

  it('does not fulfil a one-shot request when sync is disabled', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockImplementation((endpoint: string) => {
      if (endpoint === 'publish' || endpoint === 'sync-v2') {
        return Promise.reject(
          new ConvexError({ code: 'FILE_TREE_SYNC_DISABLED', message: 'disabled' })
        );
      }
      return Promise.resolve(undefined);
    });
    const host = createHost(deps.backend);

    await expect(host.oneShot('/workspace')).resolves.toBeUndefined();

    expect(startCoordinator).not.toHaveBeenCalled();
    expect(deps.backend.mutation).not.toHaveBeenCalledWith('fulfill', expect.anything());
  });

  it('stops an active coordinator when a delta send is disabled', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
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
    const host = createHost(deps.backend);

    await host.ensure('/workspace', { forceReconcile: false });
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
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'checkpoint') return Promise.resolve({ revision: 0 });
      return Promise.resolve(null);
    });
    vi.mocked(deps.backend.mutation).mockResolvedValue({ status: 'applied', revision: 4 });
    const host = createHost(deps.backend);

    await host.ensure('/workspace', { forceReconcile: false });
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
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'checkpoint') return Promise.resolve({ revision: 1 });
      return Promise.resolve(null);
    });
    vi.mocked(deps.backend.mutation).mockResolvedValue({
      status: 'published',
      revision: 7,
      prunedDeltaCount: 0,
      pruneComplete: true,
    });
    const host = createHost(deps.backend);

    await host.ensure('/workspace', { forceReconcile: false });
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

    await host.stopAll();
  });

  it('stops all workspace coordinators', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'checkpoint') return Promise.resolve({ revision: 0 });
      return Promise.resolve(null);
    });
    const host = createHost(deps.backend);

    await host.ensure('/workspace', { forceReconcile: false });
    await host.stopAll();

    expect(coordinatorHandle.stop).toHaveBeenCalled();
  });

  it('passes an undefined root snapshot reader to the coordinator', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockImplementation((endpoint: string) => {
      if (endpoint === 'checkpoint') return Promise.resolve({ revision: 0 });
      return Promise.resolve(null);
    });
    const host = createHost(deps.backend, async () => undefined);

    await host.ensure('/workspace', { forceReconcile: false });

    expect(startCoordinator.mock.calls[0]![0].readRootSnapshot).toBeUndefined();
  });
});
