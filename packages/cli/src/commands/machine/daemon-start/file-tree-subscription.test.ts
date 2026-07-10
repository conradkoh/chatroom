import type { Layer } from 'effect';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { DaemonSessionInit } from './types.js';
import type { WorkspaceFileTreeCoordinatorOptions } from '../../../infrastructure/services/workspace/workspace-file-tree-coordinator.js';

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

function makeMockWsClient() {
  return { onUpdate: vi.fn().mockReturnValue(vi.fn()) };
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
    vi.mocked(deps.backend.query).mockResolvedValue({
      revision: 0,
      snapshotKind: 'v2',
      snapshotId: 'hash',
    });
    const wsClient = makeMockWsClient();
    await runWithSession(startFileTreeSubscriptionEffect(wsClient as never), {
      machineId: 'machine-1',
      sessionId: 'session-1',
      backend: deps.backend,
    });

    const callback = wsClient.onUpdate.mock.calls[0]![2] as (
      requests: { _id: string; workingDir: string; force?: boolean }[]
    ) => void;
    callback([
      { _id: 'one', workingDir: '/workspace/' },
      { _id: 'two', workingDir: '/workspace' },
    ]);

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
    vi.mocked(deps.backend.query).mockResolvedValue({ revision: 0 });
    const wsClient = makeMockWsClient();
    await runWithSession(startFileTreeSubscriptionEffect(wsClient as never), {
      backend: deps.backend,
    });
    const callback = wsClient.onUpdate.mock.calls[0]![2] as (
      requests: { _id: string; workingDir: string; force?: boolean }[]
    ) => void;

    callback([{ _id: 'force', workingDir: '/workspace', force: true }]);

    await vi.waitFor(() => expect(coordinatorHandle.reconcile).toHaveBeenCalledTimes(1));
  });

  it('maps cached path changes to revisioned backend operations', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockResolvedValue({ revision: 0 });
    vi.mocked(deps.backend.mutation).mockResolvedValue({ status: 'applied', revision: 4 });
    const wsClient = makeMockWsClient();
    await runWithSession(startFileTreeSubscriptionEffect(wsClient as never), {
      backend: deps.backend,
    });
    const callback = wsClient.onUpdate.mock.calls[0]![2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;
    callback([{ _id: 'one', workingDir: '/workspace' }]);
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
          { operation: 'add', path: 'new.ts', entryType: 'file' },
          { operation: 'remove', path: 'old.ts' },
          { operation: 'type-change', path: 'src', entryType: 'directory' },
        ],
      })
    );
  });

  it('stops all workspace coordinators with the subscription', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockResolvedValue({ revision: 0 });
    const wsClient = makeMockWsClient();
    const handle = await runWithSession(startFileTreeSubscriptionEffect(wsClient as never), {
      backend: deps.backend,
    });
    const callback = wsClient.onUpdate.mock.calls[0]![2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;
    callback([{ _id: 'one', workingDir: '/workspace' }]);
    await vi.waitFor(() => expect(startCoordinator).toHaveBeenCalled());

    handle.stop();

    await vi.waitFor(() => expect(coordinatorHandle.stop).toHaveBeenCalled());
  });
});
