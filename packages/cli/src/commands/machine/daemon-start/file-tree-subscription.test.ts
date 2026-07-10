/**
 * File tree subscription Effect twin tests.
 */

import type { Layer } from 'effect';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { DaemonSessionInit } from './types.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      getPendingFileTreeRequests: 'mock-getPendingFileTreeRequests',
      syncFileTreeV2: 'mock-syncFileTreeV2',
      fulfillFileTreeRequest: 'mock-fulfillFileTreeRequest',
    },
  },
}));

const mockScanFileTree = vi.fn();
const mockIsGitRepo = vi.fn();
const mockLoadWorkspaceSyncManifest = vi.fn();
const mockSaveWorkspaceSyncManifest = vi.fn();
const mockEnqueueFileTreeSync = vi.fn();

const mockTree = {
  entries: [{ path: 'src/index.ts', type: 'file' as const }],
  scannedAt: 1_700_000_000_000,
  rootDir: '/workspace',
};

vi.mock('../../../infrastructure/services/workspace/file-tree-scanner.js', () => ({
  scanFileTree: (...args: unknown[]) => mockScanFileTree(...args),
}));

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  isGitRepo: (...args: unknown[]) => mockIsGitRepo(...args),
}));

vi.mock('../../../infrastructure/services/workspace/workspace-sync-state.js', () => ({
  buildPathIndex: vi.fn((entries: { path: string; type: 'file' | 'directory' }[]) =>
    Object.fromEntries(entries.map((e) => [e.path, e.type]))
  ),
  createManifestFromTree: vi.fn((args: unknown) => args),
  loadWorkspaceSyncManifest: (...args: unknown[]) => mockLoadWorkspaceSyncManifest(...args),
  saveWorkspaceSyncManifest: (...args: unknown[]) => mockSaveWorkspaceSyncManifest(...args),
}));

vi.mock('../../../infrastructure/services/workspace/workspace-sync-queue.js', () => ({
  enqueueFileTreeSync: (...args: unknown[]) => mockEnqueueFileTreeSync(...args),
}));

function makeMockWsClient(): {
  onUpdate: ReturnType<typeof vi.fn>;
} {
  return {
    onUpdate: vi.fn().mockReturnValue(vi.fn()),
  };
}

function makeSessionLayer(
  overrides?: Partial<DaemonSessionInit>
): Layer.Layer<DaemonSessionService> {
  const init = createMockDaemonSessionInit(overrides);
  return daemonSessionToLayers(init);
}

async function runWithSession<A>(
  effect: Effect.Effect<A, never, DaemonSessionService>,
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockScanFileTree.mockResolvedValue(mockTree);
  mockIsGitRepo.mockResolvedValue(true);
  mockLoadWorkspaceSyncManifest.mockResolvedValue(null);
  mockSaveWorkspaceSyncManifest.mockResolvedValue(undefined);
  mockEnqueueFileTreeSync.mockImplementation(
    async (_machineId: string, _workingDir: string, task: () => Promise<void>) => {
      await task();
    }
  );
});

describe('startFileTreeSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(startFileTreeSubscriptionEffect(wsClient as any));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('calls onUpdate with sessionId and machineId from session', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const wsClient = makeMockWsClient();

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-tree',
      machineId: 'machine-tree',
    });

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-tree', machineId: 'machine-tree' }),
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('fulfills pending requests via syncFileTreeV2 and fulfillFileTreeRequest', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    const wsClient = makeMockWsClient();

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-fulfill',
      machineId: 'machine-fulfill',
      backend: deps.backend,
    });

    const onUpdateCallback = vi.mocked(wsClient.onUpdate).mock.calls[0]?.[2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;

    onUpdateCallback([{ _id: 'req-1', workingDir: '/workspace' }]);

    await vi.waitFor(() => {
      expect(mockScanFileTree).toHaveBeenCalledWith('/workspace');
      expect(deps.backend.mutation).toHaveBeenCalled();
    });

    const mutationCalls = vi.mocked(deps.backend.mutation).mock.calls.map((call) => call[0]);
    expect(mutationCalls).toContain('mock-syncFileTreeV2');
    expect(mutationCalls).toContain('mock-fulfillFileTreeRequest');
  });

  it('normalizes trailing-slash workingDir before scan and upload', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    const wsClient = makeMockWsClient();

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-slash',
      machineId: 'machine-slash',
      backend: deps.backend,
    });

    const onUpdateCallback = vi.mocked(wsClient.onUpdate).mock.calls[0]?.[2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;

    onUpdateCallback([{ _id: 'req-1', workingDir: '/workspace/' }]);

    await vi.waitFor(() => {
      expect(mockScanFileTree).toHaveBeenCalledWith('/workspace');
    });

    const syncCall = vi
      .mocked(deps.backend.mutation)
      .mock.calls.find((call) => call[0] === 'mock-syncFileTreeV2');
    expect(syncCall?.[1]).toEqual(
      expect.objectContaining({
        workingDir: '/workspace',
      })
    );
  });

  it('saves manifest after successful upload and fulfill', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    const wsClient = makeMockWsClient();

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-manifest',
      machineId: 'machine-manifest',
      backend: deps.backend,
    });

    const onUpdateCallback = vi.mocked(wsClient.onUpdate).mock.calls[0]?.[2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;

    onUpdateCallback([{ _id: 'req-1', workingDir: '/workspace' }]);

    await vi.waitFor(() => {
      expect(mockSaveWorkspaceSyncManifest).toHaveBeenCalledTimes(1);
    });
  });

  it('does not save manifest when sync mutation fails', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockImplementation(async (name) => {
      if (name === 'mock-syncFileTreeV2') {
        throw new Error('sync failed');
      }
    });
    const wsClient = makeMockWsClient();

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-fail',
      machineId: 'machine-fail',
      backend: deps.backend,
    });

    const onUpdateCallback = vi.mocked(wsClient.onUpdate).mock.calls[0]?.[2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;

    onUpdateCallback([{ _id: 'req-1', workingDir: '/workspace' }]);

    await vi.waitFor(() => {
      expect(mockScanFileTree).toHaveBeenCalled();
    });

    expect(mockSaveWorkspaceSyncManifest).not.toHaveBeenCalled();
  });

  it('dedupes duplicate workingDirs in one callback batch', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    const wsClient = makeMockWsClient();

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-dedupe',
      machineId: 'machine-dedupe',
      backend: deps.backend,
    });

    const onUpdateCallback = vi.mocked(wsClient.onUpdate).mock.calls[0]?.[2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;

    onUpdateCallback([
      { _id: 'req-1', workingDir: '/workspace' },
      { _id: 'req-2', workingDir: '/workspace/' },
      { _id: 'req-3', workingDir: '/workspace' },
    ]);

    await vi.waitFor(() => {
      expect(mockEnqueueFileTreeSync).toHaveBeenCalledTimes(1);
    });
  });

  it('skips upload when manifest hash matches but still fulfills request', async () => {
    const { computeFileTreeDataHash } =
      await import('../../../infrastructure/services/workspace/file-tree-data-hash.js');
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    const wsClient = makeMockWsClient();

    mockLoadWorkspaceSyncManifest.mockResolvedValue({
      version: '1',
      machineId: 'machine-unchanged',
      workingDir: '/workspace',
      syncGeneration: 'gen-1',
      completedAt: 1,
      scanner: 'git',
      dataHash: computeFileTreeDataHash(mockTree),
      totalEntryCount: 1,
      paths: { 'src/index.ts': 'file' },
    });

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-unchanged',
      machineId: 'machine-unchanged',
      backend: deps.backend,
    });

    const onUpdateCallback = vi.mocked(wsClient.onUpdate).mock.calls[0]?.[2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;

    onUpdateCallback([{ _id: 'req-1', workingDir: '/workspace' }]);

    await vi.waitFor(() => {
      expect(deps.backend.mutation).toHaveBeenCalled();
    });

    const mutationCalls = vi.mocked(deps.backend.mutation).mock.calls.map((call) => call[0]);
    expect(mutationCalls).not.toContain('mock-syncFileTreeV2');
    expect(mutationCalls).toContain('mock-fulfillFileTreeRequest');
    expect(mockSaveWorkspaceSyncManifest).not.toHaveBeenCalled();
  });

  it('uploads and saves manifest when manifest hash differs', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    const wsClient = makeMockWsClient();

    mockLoadWorkspaceSyncManifest.mockResolvedValue({
      version: '1',
      machineId: 'machine-changed',
      workingDir: '/workspace',
      syncGeneration: 'gen-1',
      completedAt: 1,
      scanner: 'git',
      dataHash: 'old-hash',
      totalEntryCount: 0,
      paths: {},
    });

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-changed',
      machineId: 'machine-changed',
      backend: deps.backend,
    });

    const onUpdateCallback = vi.mocked(wsClient.onUpdate).mock.calls[0]?.[2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;

    onUpdateCallback([{ _id: 'req-1', workingDir: '/workspace' }]);

    await vi.waitFor(() => {
      expect(mockSaveWorkspaceSyncManifest).toHaveBeenCalledTimes(1);
    });

    const mutationCalls = vi.mocked(deps.backend.mutation).mock.calls.map((call) => call[0]);
    expect(mutationCalls).toContain('mock-syncFileTreeV2');
    expect(mutationCalls).toContain('mock-fulfillFileTreeRequest');
  });

  it('performs full upload when no manifest exists', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    const wsClient = makeMockWsClient();

    mockLoadWorkspaceSyncManifest.mockResolvedValue(null);

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-first',
      machineId: 'machine-first',
      backend: deps.backend,
    });

    const onUpdateCallback = vi.mocked(wsClient.onUpdate).mock.calls[0]?.[2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;

    onUpdateCallback([{ _id: 'req-1', workingDir: '/workspace' }]);

    await vi.waitFor(() => {
      expect(mockSaveWorkspaceSyncManifest).toHaveBeenCalledTimes(1);
    });

    const mutationCalls = vi.mocked(deps.backend.mutation).mock.calls.map((call) => call[0]);
    expect(mutationCalls).toContain('mock-syncFileTreeV2');
    expect(mutationCalls).toContain('mock-fulfillFileTreeRequest');
  });
});
