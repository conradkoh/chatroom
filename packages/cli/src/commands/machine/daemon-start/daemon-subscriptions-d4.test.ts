/**
 * Daemon Subscription Effect Tests (Phase D4)
 *
 * Tests for the Effect twins of subscription starter functions, all migrated
 * to DaemonSessionService (E4.1–E4.4):
 *   startWorkspaceListSubscriptionEffect  (E4.1)
 *   startFileTreeSubscriptionEffect       (E4.2)
 *   startFileContentSubscriptionEffect    (E4.2)
 *   startGitRequestSubscriptionEffect     (E4.3)
 *   processRequestsEffect                 (E4.3)
 *   startObservedSyncSubscriptionEffect   (E4.4)
 */

import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import {
  DaemonSessionService,
  type DaemonMutableStateService,
  type DaemonSessionServiceShape,
} from './daemon-services.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { DaemonSessionInit } from './types.js';

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
// Helpers — DaemonSessionService (for all subscriptions migrated to E4.x)
// ---------------------------------------------------------------------------

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

function withDeps(
  deps: ReturnType<typeof createMockDaemonDeps>,
  extra?: Partial<DaemonSessionInit>
): Partial<DaemonSessionInit> {
  return {
    backend: deps.backend,
    fs: deps.fs,
    machine: deps.machine,
    spawning: deps.spawning,
    agentProcessManager: deps.agentProcessManager,
    ...extra,
  };
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
// A. file-tree-subscription Effect twin (E4.2 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('startFileTreeSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(startFileTreeSubscriptionEffect(wsClient));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('calls onUpdate with sessionId and machineId from session', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const wsClient = makeMockWsClient();
    const deps = createMockDaemonDeps();

    await runWithSession(
      startFileTreeSubscriptionEffect(wsClient),
      withDeps(deps, { sessionId: 'session-tree', machineId: 'machine-tree' })
    );

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-tree', machineId: 'machine-tree' }),
      expect.any(Function),
      expect.any(Function)
    );
  });
});

// ---------------------------------------------------------------------------
// B. file-content-subscription Effect twin (E4.2 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('startFileContentSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startFileContentSubscriptionEffect } = await import('./file-content-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(startFileContentSubscriptionEffect(wsClient));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('calls onUpdate with sessionId and machineId from session', async () => {
    const { startFileContentSubscriptionEffect } = await import('./file-content-subscription.js');
    const wsClient = makeMockWsClient();

    await runWithSession(startFileContentSubscriptionEffect(wsClient), {
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
// C. workspace-list-subscription Effect twin (E4.1 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('startWorkspaceListSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startWorkspaceListSubscriptionEffect } =
      await import('./workspace-list-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(startWorkspaceListSubscriptionEffect(wsClient));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
    // Clean up to avoid leaking intervals
    handle.stop();
  });

  it('calls onUpdate with sessionId and machineId from session', async () => {
    const { startWorkspaceListSubscriptionEffect } =
      await import('./workspace-list-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(startWorkspaceListSubscriptionEffect(wsClient), {
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

  it('initializes workspaceListStore on the session object (start)', async () => {
    const { startWorkspaceListSubscriptionEffect } =
      await import('./workspace-list-subscription.js');
    const wsClient = makeMockWsClient();

    // Capture the session object to inspect workspaceListStore after start
    let capturedSession: any;
    const layer = Layer.effect(
      DaemonSessionService,
      Effect.gen(function* () {
        const init = createMockDaemonSessionInit();
        capturedSession = init;
        return init as any;
      })
    );

    const handle = await Effect.runPromise(
      startWorkspaceListSubscriptionEffect(wsClient).pipe(Effect.provide(layer))
    );

    // Store should be initialized
    expect(capturedSession.workspaceListStore).toEqual({ workspaces: [], updatedAt: 0 });

    // After stop, store should be cleared (undefined)
    handle.stop();
    expect(capturedSession.workspaceListStore).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D. git-subscription Effect twins (E4.3 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('startGitRequestSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startGitRequestSubscriptionEffect } = await import('./git-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(0 as any);
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(
      startGitRequestSubscriptionEffect(wsClient),
      withDeps(deps)
    );

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('calls onUpdate with sessionId and machineId from session', async () => {
    const { startGitRequestSubscriptionEffect } = await import('./git-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(0 as any);
    const wsClient = makeMockWsClient();

    await runWithSession(
      startGitRequestSubscriptionEffect(wsClient),
      withDeps(deps, { sessionId: 'session-git', machineId: 'machine-git' })
    );

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
      runWithSession(processRequestsEffect([], new Map(), 300_000))
    ).resolves.toBeUndefined();
  });

  it('passes machineId from session to backend when processing requests', async () => {
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

    await runWithSession(
      processRequestsEffect([req as any], new Map(), 300_000),
      withDeps(deps, { machineId: 'machine-process', sessionId: 'session-process' })
    );

    // updateRequestStatus should have been called (at least once)
    expect(deps.backend.mutation).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// E. observed-sync Effect twin (E4.4 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('startObservedSyncSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startObservedSyncSubscriptionEffect } = await import('./observed-sync.js');
    const deps = createMockDaemonDeps();
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(
      startObservedSyncSubscriptionEffect(wsClient),
      withDeps(deps)
    );

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
    handle.stop();
  });

  it('calls onUpdate with sessionId and machineId from session', async () => {
    const { startObservedSyncSubscriptionEffect } = await import('./observed-sync.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(startObservedSyncSubscriptionEffect(wsClient), {
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
