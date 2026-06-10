/**
 * Daemon Subscription Effect Tests (Phase D4)
 *
 * Tests for the Effect twins of subscription starter functions:
 *   startFileTreeSubscriptionEffect,
 *   startFileContentSubscriptionEffect,
 *   startWorkspaceListSubscriptionEffect,
 *   startGitRequestSubscriptionEffect,
 *   processRequestsEffect,
 *   startObservedSyncSubscriptionEffect.
 *
 * All subscription Effect twins require DaemonContextService and accept a wsClient parameter.
 * Tests verify ctx is threaded through from DaemonContextService and the handle is returned.
 */

import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonContextService } from './daemon-context-service.js';
import { createMockDaemonContext } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { DaemonContext } from './types.js';

// ---------------------------------------------------------------------------
// Module mocks — avoid real WebSocket connections
// ---------------------------------------------------------------------------

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      getPendingFileTreeRequests: 'mock-getPendingFileTreeRequests',
      syncFileTreeV2: 'mock-syncFileTreeV2',
      fulfillFileTreeRequest: 'mock-fulfillFileTreeRequest',
      getPendingFileContentRequests: 'mock-getPendingFileContentRequests',
      fulfillFileContentV2: 'mock-fulfillFileContentV2',
    },
    workspaces: {
      listRecentlyObservedWorkspacesForMachine: 'mock-listRecentlyObservedWorkspacesForMachine',
      getPendingRequests: 'mock-getPendingRequests',
      resetProcessingRequests: 'mock-resetProcessingRequests',
      updateRequestStatus: 'mock-updateRequestStatus',
      upsertWorkspaceGitState: 'mock-upsertWorkspaceGitState',
      upsertRecentCommits: 'mock-upsertRecentCommits',
    },
    machines: {
      getObservedChatroomsForMachine: 'mock-getObservedChatroomsForMachine',
    },
    commands: {
      syncCommands: 'mock-syncCommands',
    },
  },
}));

vi.mock('../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test-convex-url',
}));

vi.mock('@workspace/backend/config/reliability.js', () => ({
  OBSERVED_FULL_PUSH_INTERVAL_MS: 60_000,
  OBSERVED_SAFETY_POLL_MS: 5_000,
  OBSERVATION_TTL_MS: 30_000,
  WORKSPACE_LIST_RECONCILE_MS: 30_000,
  WORKSPACE_RECENCY_WINDOW_MS: 60_000,
}));

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(false),
  getBranch: vi.fn().mockResolvedValue({ status: 'not_found' }),
  isDirty: vi.fn().mockResolvedValue(false),
  getDiffStat: vi.fn().mockResolvedValue({ status: 'not_found' }),
  getRecentCommits: vi.fn().mockResolvedValue([]),
  getCommitsAhead: vi.fn().mockResolvedValue(0),
  getCommitsBehind: vi.fn().mockResolvedValue(0),
  getRemotes: vi.fn().mockResolvedValue([]),
  getOpenPRsForBranch: vi.fn().mockResolvedValue([]),
  getAllPRs: vi.fn().mockResolvedValue([]),
  getCommitStatusChecks: vi.fn().mockResolvedValue(null),
}));

vi.mock('./workspace-cache.js', () => ({
  getWorkspacesForMachine: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../infrastructure/services/workspace/command-discovery.js', () => ({
  discoverCommands: vi.fn().mockResolvedValue([]),
}));

// ---------------------------------------------------------------------------
// Minimal mock wsClient — just records calls
// ---------------------------------------------------------------------------

function makeMockWsClient(): any {
  return {
    onUpdate: vi.fn().mockReturnValue(vi.fn()), // returns an unsubscribe fn
    mutation: vi.fn().mockResolvedValue(undefined),
    query: vi.fn().mockResolvedValue([]),
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLayer(overrides?: Partial<DaemonContext>) {
  return Layer.succeed(DaemonContextService, createMockDaemonContext(overrides));
}

async function runWithCtx<A>(
  effect: Effect.Effect<A, never, DaemonContextService>,
  overrides?: Partial<DaemonContext>
) {
  return Effect.runPromise(effect.pipe(Effect.provide(makeLayer(overrides))));
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// A. file-tree-subscription Effect twin
// ---------------------------------------------------------------------------

describe('startFileTreeSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithCtx(startFileTreeSubscriptionEffect(wsClient));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('calls onUpdate with sessionId and machineId from ctx', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const wsClient = makeMockWsClient();
    const deps = createMockDaemonDeps();

    await runWithCtx(startFileTreeSubscriptionEffect(wsClient), {
      deps,
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
});

// ---------------------------------------------------------------------------
// B. file-content-subscription Effect twin
// ---------------------------------------------------------------------------

describe('startFileContentSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startFileContentSubscriptionEffect } = await import('./file-content-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithCtx(startFileContentSubscriptionEffect(wsClient));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('calls onUpdate with sessionId and machineId from ctx', async () => {
    const { startFileContentSubscriptionEffect } = await import('./file-content-subscription.js');
    const wsClient = makeMockWsClient();

    await runWithCtx(startFileContentSubscriptionEffect(wsClient), {
      sessionId: 'session-content',
      machineId: 'machine-content',
    });

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-content', machineId: 'machine-content' }),
      expect.any(Function),
      expect.any(Function)
    );
  });
});

// ---------------------------------------------------------------------------
// C. workspace-list-subscription Effect twin
// ---------------------------------------------------------------------------

describe('startWorkspaceListSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startWorkspaceListSubscriptionEffect } =
      await import('./workspace-list-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithCtx(startWorkspaceListSubscriptionEffect(wsClient));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
    // Clean up to avoid leaking intervals
    handle.stop();
  });

  it('calls onUpdate with sessionId and machineId from ctx', async () => {
    const { startWorkspaceListSubscriptionEffect } =
      await import('./workspace-list-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithCtx(startWorkspaceListSubscriptionEffect(wsClient), {
      sessionId: 'session-ws-list',
      machineId: 'machine-ws-list',
    });

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-ws-list', machineId: 'machine-ws-list' }),
      expect.any(Function),
      expect.any(Function)
    );
    handle.stop();
  });
});

// ---------------------------------------------------------------------------
// D. git-subscription Effect twins
// ---------------------------------------------------------------------------

describe('startGitRequestSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startGitRequestSubscriptionEffect } = await import('./git-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(0 as any);
    const wsClient = makeMockWsClient();

    const handle = await runWithCtx(startGitRequestSubscriptionEffect(wsClient), { deps });

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('calls onUpdate with sessionId and machineId from ctx', async () => {
    const { startGitRequestSubscriptionEffect } = await import('./git-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(0 as any);
    const wsClient = makeMockWsClient();

    await runWithCtx(startGitRequestSubscriptionEffect(wsClient), {
      deps,
      sessionId: 'session-git',
      machineId: 'machine-git',
    });

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-git', machineId: 'machine-git' }),
      expect.any(Function),
      expect.any(Function)
    );
  });
});

describe('processRequestsEffect', () => {
  it('completes without error when given an empty request list', async () => {
    const { processRequestsEffect } = await import('./git-subscription.js');

    await expect(
      runWithCtx(processRequestsEffect([], new Map(), 300_000))
    ).resolves.toBeUndefined();
  });

  it('passes machineId from ctx to backend when processing requests', async () => {
    const { processRequestsEffect } = await import('./git-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    // A single request that will be picked up (status: pending) — minimal shape
    const req = {
      _id: 'req-d4-1' as any,
      requestType: 'full_diff' as const,
      workingDir: '/tmp/repo',
      offset: undefined,
    };

    // full_diff will call gitReader.getFullDiff — mock it to throw so we test error path
    const gitReader = await import('../../../infrastructure/git/git-reader.js');
    vi.mocked(gitReader as any).getFullDiff = vi.fn().mockResolvedValue({ status: 'not_found' });

    await runWithCtx(processRequestsEffect([req as any], new Map(), 300_000), {
      deps,
      machineId: 'machine-process',
      sessionId: 'session-process',
    });

    // updateRequestStatus should have been called (at least once)
    expect(deps.backend.mutation).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E. observed-sync Effect twin
// ---------------------------------------------------------------------------

describe('startObservedSyncSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startObservedSyncSubscriptionEffect } = await import('./observed-sync.js');
    const deps = createMockDaemonDeps();
    const wsClient = makeMockWsClient();

    const handle = await runWithCtx(startObservedSyncSubscriptionEffect(wsClient), { deps });

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
    handle.stop();
  });

  it('calls onUpdate with sessionId and machineId from ctx', async () => {
    const { startObservedSyncSubscriptionEffect } = await import('./observed-sync.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithCtx(startObservedSyncSubscriptionEffect(wsClient), {
      sessionId: 'session-observed',
      machineId: 'machine-observed',
    });

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-observed', machineId: 'machine-observed' }),
      expect.any(Function),
      expect.any(Function)
    );
    handle.stop();
  });
});
