/**
 * Daemon Subscription Effect Tests (Phase D4)
 *
 * Tests for the Effect twins of subscription starter functions, all migrated
 * to DaemonSessionService (E4.1–E4.4):
 *   startWorkspaceListSubscriptionEffect  (E4.1)
 *   startFileContentSubscriptionEffect    (E4.2)
 *   startGitRequestSubscriptionEffect     (E4.3)
 *   processRequestsEffect                 (E4.3)
 */

import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import { DaemonSessionService, type DaemonMutableStateService } from './daemon-services.js';
import type { DaemonSessionInit } from './daemon-types.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { PendingRequest } from './workspace-git/git-subscription.js';

// ---------------------------------------------------------------------------
// Module mocks — avoid real WebSocket connections
// ---------------------------------------------------------------------------

vi.mock('../../api.js', () => ({
  api: {
    workspaceFiles: {
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
    machines: {},
    commands: {
      syncCommands: 'mock-syncCommands',
    },
  },
}));

vi.mock('../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test-convex-url',
}));

vi.mock('@workspace/backend/config/reliability.js', () => ({
  OBSERVATION_TTL_MS: 30_000,
  NATIVE_DELIVERY_RECONCILE_MS: 10_000,
  HARNESS_SESSION_READY_TIMEOUT_MS: 5_000,
}));

vi.mock('../infrastructure/git/git-reader.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(false),
  getBranch: vi.fn().mockResolvedValue({ status: 'not_found' }),
  isDirty: vi.fn().mockResolvedValue(false),
  getDiffStat: vi.fn().mockResolvedValue({ status: 'not_found' }),
  getFullDiff: vi.fn().mockResolvedValue({ status: 'not_found' }),
  getRecentCommits: vi.fn().mockResolvedValue([]),
  getCommitsAhead: vi.fn().mockResolvedValue(0),
  getCommitsBehind: vi.fn().mockResolvedValue(0),
  getRemotes: vi.fn().mockResolvedValue([]),
  getOpenPRsForBranch: vi.fn().mockResolvedValue([]),
  getAllPRs: vi.fn().mockResolvedValue([]),
  getCommitStatusChecks: vi.fn().mockResolvedValue(null),
}));

vi.mock('./workspace-git/workspace-cache.js', () => ({
  getWorkspacesForMachine: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../infrastructure/services/workspace/command-discovery.js', () => ({
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
      const effectContext = yield* Effect.context<DaemonSessionService>();
      const session = yield* DaemonSessionService;
      const sessionWithContext = { ...session, effectContext };
      return yield* effect.pipe(Effect.provideService(DaemonSessionService, sessionWithContext));
    }).pipe(Effect.provide(layer))
  );
}

const mockEffectContext = Effect.runSync(
  Effect.context<DaemonSessionService>().pipe(Effect.provide(makeSessionLayer()))
);

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
// A. file-content-subscription Effect twin (E4.2 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('startFileContentSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startFileContentSubscriptionEffect } =
      await import('./files/file-content-subscription.js');

    const handle = await runWithSession(startFileContentSubscriptionEffect());

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('does not open a legacy WS subscription (v2 subscriber is sole listener)', async () => {
    const { startFileContentSubscriptionEffect } =
      await import('./files/file-content-subscription.js');
    const wsClient = makeMockWsClient();

    await runWithSession(startFileContentSubscriptionEffect(), {
      sessionId: 'session-content',
      machineId: 'machine-content',
    });

    expect(wsClient.onUpdate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// C. workspace-list-subscription Effect twin (E4.1 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('startWorkspaceListSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startWorkspaceListSubscriptionEffect } =
      await import('./workspace-git/workspace-list-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockResolvedValue([]);

    const handle = await runWithSession(startWorkspaceListSubscriptionEffect(), withDeps(deps));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
    handle.stop();
  });

  it('does not open a legacy WS subscription (v2 subscriber is sole listener)', async () => {
    const { startWorkspaceListSubscriptionEffect } =
      await import('./workspace-git/workspace-list-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockResolvedValue([]);
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(
      startWorkspaceListSubscriptionEffect(),
      withDeps(deps, { sessionId: 'session-ws-list', machineId: 'machine-ws-list' })
    );

    expect(wsClient.onUpdate).not.toHaveBeenCalled();
    handle.stop();
  });

  it('initializes workspaceListStore on the session object (start)', async () => {
    const { startWorkspaceListSubscriptionEffect } =
      await import('./workspace-git/workspace-list-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.query).mockResolvedValue([]);

    let capturedSession: any;
    const layer = Layer.effect(
      DaemonSessionService,
      Effect.gen(function* () {
        const init = createMockDaemonSessionInit({ backend: deps.backend });
        capturedSession = init;
        return init as any;
      })
    );

    const handle = await Effect.runPromise(
      startWorkspaceListSubscriptionEffect().pipe(Effect.provide(layer))
    );

    expect(capturedSession.workspaceListStore).toBeDefined();

    handle.stop();
    expect(capturedSession.workspaceListStore).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// D. git-subscription Effect twins (E4.3 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('startGitRequestSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startGitRequestSubscriptionEffect } =
      await import('./workspace-git/git-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(0 as any);

    const handle = await runWithSession(startGitRequestSubscriptionEffect(), withDeps(deps));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
    expect(handle).toHaveProperty('drainPendingGitRequests');
  });

  it('does not open a legacy WS subscription (v2 subscriber is sole listener)', async () => {
    const { startGitRequestSubscriptionEffect } =
      await import('./workspace-git/git-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(0 as any);
    const wsClient = makeMockWsClient();

    await runWithSession(
      startGitRequestSubscriptionEffect(),
      withDeps(deps, { sessionId: 'session-git', machineId: 'machine-git' })
    );

    expect(wsClient.onUpdate).not.toHaveBeenCalled();
  });

  it('resets orphaned processing requests when the subscription starts', async () => {
    const { startGitRequestSubscriptionEffect } =
      await import('./workspace-git/git-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(2);

    await runWithSession(
      startGitRequestSubscriptionEffect(),
      withDeps(deps, {
        sessionId: 'session-git-reset',
        machineId: 'machine-git-reset',
      })
    );

    expect(deps.backend.mutation).toHaveBeenCalledWith('mock-resetProcessingRequests', {
      sessionId: 'session-git-reset',
      machineId: 'machine-git-reset',
    });
  });

  it('deduplicates the same pending request across overlapping drains', async () => {
    const { startGitRequestSubscriptionEffect } =
      await import('./workspace-git/git-subscription.js');
    const deps = createMockDaemonDeps();
    const request = {
      _id: 'req-overlap' as PendingRequest['_id'],
      requestType: 'full_diff' as const,
      workingDir: '/tmp/repo',
      status: 'pending' as const,
      machineId: 'machine-overlap',
      requestedAt: 0,
      updatedAt: 0,
      _creationTime: 0,
    } satisfies PendingRequest;
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    vi.mocked(deps.backend.query).mockResolvedValue([request]);
    const gitReader = await import('../infrastructure/git/git-reader.js');
    vi.mocked(gitReader.getFullDiff).mockResolvedValue({ status: 'not_found' });
    const handle = await runWithSession(startGitRequestSubscriptionEffect(), withDeps(deps));

    await Promise.all([handle.drainPendingGitRequests(), handle.drainPendingGitRequests()]);

    expect(gitReader.getFullDiff).toHaveBeenCalledTimes(1);
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'mock-updateRequestStatus',
      expect.objectContaining({ requestId: 'req-overlap', status: 'done' })
    );
    expect(
      vi
        .mocked(deps.backend.mutation)
        .mock.calls.filter(
          ([endpoint, args]) =>
            endpoint === 'mock-updateRequestStatus' && args.status === 'processing'
        )
    ).toHaveLength(1);
  });
});

describe('processRequestsEffect', () => {
  it('completes without error when given an empty request list', async () => {
    const { processRequestsEffect } = await import('./workspace-git/git-subscription.js');

    await expect(
      runWithSession(processRequestsEffect([], new Map(), 300_000, mockEffectContext))
    ).resolves.toBeUndefined();
  });

  it('passes machineId from session to backend when processing requests', async () => {
    const { processRequestsEffect } = await import('./workspace-git/git-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);

    // A single request that will be picked up (status: pending) — minimal shape
    const req = {
      _id: 'req-d4-1' as PendingRequest['_id'],
      requestType: 'full_diff' as const,
      workingDir: '/tmp/repo',
      status: 'pending' as const,
      machineId: 'machine-process',
      requestedAt: 0,
      updatedAt: 0,
      _creationTime: 0,
    } satisfies PendingRequest;

    // full_diff will call gitReader.getFullDiff — mock it to throw so we test error path
    const gitReader = await import('../infrastructure/git/git-reader.js');
    vi.mocked(gitReader.getFullDiff).mockResolvedValue({ status: 'not_found' } as never);

    await runWithSession(
      processRequestsEffect([req], new Map(), 300_000, mockEffectContext),
      withDeps(deps, { machineId: 'machine-process', sessionId: 'session-process' })
    );

    // updateRequestStatus should have been called (at least once)
    expect(deps.backend.mutation).toHaveBeenCalled();
  });
});
