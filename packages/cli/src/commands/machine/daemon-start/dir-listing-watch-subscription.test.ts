/**
 * Dir listing watch subscription tests
 */

import type { Layer } from 'effect';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import {
  DaemonSessionService,
  type DaemonMutableStateService,
  type DaemonSessionServiceShape,
} from './daemon-services.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import type { DaemonSessionInit } from './types.js';

const mockCreateWatcher = vi.fn();
const mockWatcherStop = vi.fn();
const mockWatcherUpdate = vi.fn();

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      listDirListingWatchTargets: 'mock-listDirListingWatchTargets',
      syncDirListingV2: 'mock-syncDirListingV2',
    },
  },
}));

vi.mock('../../../infrastructure/services/workspace/dir-listing-sync.js', () => ({
  syncDirListingsToBackend: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../infrastructure/services/workspace/workspace-fs-watcher.js', () => ({
  createWorkspaceFsWatcher: (...args: unknown[]) => mockCreateWatcher(...args),
}));

function makeMockWsClient(): {
  onUpdate: ReturnType<typeof vi.fn>;
} {
  return {
    onUpdate: vi.fn().mockReturnValue(vi.fn()),
  };
}

type SubscriptionEffectRequirements = DaemonSessionService | DaemonMutableStateService;

function makeSessionLayer(
  overrides?: Partial<DaemonSessionInit>
): Layer.Layer<SubscriptionEffectRequirements> {
  const init = createMockDaemonSessionInit(overrides);
  return daemonSessionToLayers(init);
}

async function runWithSession<A>(
  effect: Effect.Effect<A, never, SubscriptionEffectRequirements>,
  overrides?: Partial<DaemonSessionInit>
) {
  const layer = makeSessionLayer(overrides);
  return Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<DaemonSessionService>();
      const session = yield* DaemonSessionService;
      const sessionWithRuntime = { ...session, runtime };
      return yield* effect.pipe(
        Effect.provideService(DaemonSessionService, sessionWithRuntime as DaemonSessionServiceShape)
      );
    }).pipe(Effect.provide(layer))
  );
}

describe('startDirListingWatchSubscriptionEffect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    mockCreateWatcher.mockReturnValue({
      stop: mockWatcherStop,
      updateActiveDirPaths: mockWatcherUpdate,
    });
  });

  it('returns a handle with stop()', async () => {
    const { startDirListingWatchSubscriptionEffect } =
      await import('./dir-listing-watch-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(startDirListingWatchSubscriptionEffect(wsClient as any));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('subscribes to listDirListingWatchTargets with session identity', async () => {
    const { startDirListingWatchSubscriptionEffect } =
      await import('./dir-listing-watch-subscription.js');
    const wsClient = makeMockWsClient();

    await runWithSession(startDirListingWatchSubscriptionEffect(wsClient as any), {
      sessionId: 'session-watch',
      machineId: 'machine-watch',
    });

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      'mock-listDirListingWatchTargets',
      expect.objectContaining({ sessionId: 'session-watch', machineId: 'machine-watch' }),
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('creates a watcher when targets arrive and stops on handle.stop()', async () => {
    const { startDirListingWatchSubscriptionEffect } =
      await import('./dir-listing-watch-subscription.js');
    const wsClient = makeMockWsClient();
    const unsub = vi.fn();
    wsClient.onUpdate.mockReturnValue(unsub);

    const handle = await runWithSession(startDirListingWatchSubscriptionEffect(wsClient as any));

    const onTargets = wsClient.onUpdate.mock.calls[0]?.[2] as
      | ((targets: { workingDir: string; activeDirPaths: string[] }[]) => void)
      | undefined;
    expect(onTargets).toBeTypeOf('function');

    onTargets?.([
      {
        workingDir: '/workspace',
        activeDirPaths: ['', 'src'],
      },
    ]);

    expect(mockCreateWatcher).toHaveBeenCalledWith(
      expect.objectContaining({
        workingDir: '/workspace',
        activeDirPaths: new Set(['', 'src']),
      })
    );

    handle.stop();

    expect(unsub).toHaveBeenCalled();
    expect(mockWatcherStop).toHaveBeenCalled();
  });

  it('calls syncDirListingsToBackend when watcher refreshes dirs', async () => {
    const { startDirListingWatchSubscriptionEffect } =
      await import('./dir-listing-watch-subscription.js');
    const { syncDirListingsToBackend } =
      await import('../../../infrastructure/services/workspace/dir-listing-sync.js');
    const wsClient = makeMockWsClient();

    let onRefreshDirs: ((dirPaths: string[]) => Promise<void>) | undefined;
    mockCreateWatcher.mockImplementation(
      (opts: { onRefreshDirs: (dirPaths: string[]) => Promise<void> }) => {
        onRefreshDirs = opts.onRefreshDirs;
        return { stop: mockWatcherStop, updateActiveDirPaths: mockWatcherUpdate };
      }
    );

    await runWithSession(startDirListingWatchSubscriptionEffect(wsClient as any), {
      sessionId: 'session-sync',
      machineId: 'machine-sync',
    });

    const onTargets = wsClient.onUpdate.mock.calls[0]?.[2] as
      | ((targets: { workingDir: string; activeDirPaths: string[] }[]) => void)
      | undefined;
    onTargets?.([{ workingDir: '/workspace', activeDirPaths: ['', 'src'] }]);

    await onRefreshDirs?.(['', 'src']);

    expect(syncDirListingsToBackend).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-sync', machineId: 'machine-sync' }),
      '/workspace',
      ['', 'src']
    );
  });

  it('updates active dirs on existing watcher when targets change', async () => {
    const { startDirListingWatchSubscriptionEffect } =
      await import('./dir-listing-watch-subscription.js');
    const wsClient = makeMockWsClient();

    await runWithSession(startDirListingWatchSubscriptionEffect(wsClient as any));

    const onTargets = wsClient.onUpdate.mock.calls[0]?.[2] as
      | ((targets: { workingDir: string; activeDirPaths: string[] }[]) => void)
      | undefined;

    onTargets?.([{ workingDir: '/workspace', activeDirPaths: [''] }]);
    onTargets?.([{ workingDir: '/workspace', activeDirPaths: ['', 'src'] }]);

    expect(mockCreateWatcher).toHaveBeenCalledTimes(1);
    expect(mockWatcherUpdate).toHaveBeenCalledWith(new Set(['', 'src']));
  });

  it('stops watcher when working dir is removed from targets', async () => {
    const { startDirListingWatchSubscriptionEffect } =
      await import('./dir-listing-watch-subscription.js');
    const wsClient = makeMockWsClient();

    await runWithSession(startDirListingWatchSubscriptionEffect(wsClient as any));

    const onTargets = wsClient.onUpdate.mock.calls[0]?.[2] as
      | ((targets: { workingDir: string; activeDirPaths: string[] }[]) => void)
      | undefined;

    onTargets?.([{ workingDir: '/workspace', activeDirPaths: [''] }]);
    onTargets?.([]);

    expect(mockWatcherStop).toHaveBeenCalled();
  });

  it('logs warning when sync fails but does not throw', async () => {
    const { startDirListingWatchSubscriptionEffect } =
      await import('./dir-listing-watch-subscription.js');
    const { syncDirListingsToBackend } =
      await import('../../../infrastructure/services/workspace/dir-listing-sync.js');
    const wsClient = makeMockWsClient();

    let onRefreshDirs: ((dirPaths: string[]) => Promise<void>) | undefined;
    mockCreateWatcher.mockImplementation(
      (opts: { onRefreshDirs: (dirPaths: string[]) => Promise<void> }) => {
        onRefreshDirs = opts.onRefreshDirs;
        return { stop: mockWatcherStop, updateActiveDirPaths: mockWatcherUpdate };
      }
    );
    vi.mocked(syncDirListingsToBackend).mockRejectedValueOnce(new Error('network down'));

    await runWithSession(startDirListingWatchSubscriptionEffect(wsClient as any));

    const onTargets = wsClient.onUpdate.mock.calls[0]?.[2] as
      | ((targets: { workingDir: string; activeDirPaths: string[] }[]) => void)
      | undefined;
    onTargets?.([{ workingDir: '/workspace', activeDirPaths: [''] }]);

    await onRefreshDirs?.(['']);

    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('FS watch sync failed for /workspace')
    );
  });
});
