/**
 * Daemon Command Loop Effect Tests (Phase D5)
 *
 * Tests for the Effect twins of command-loop functions:
 *   refreshModelsEffect, dispatchCommandEventEffect, startCommandLoopEffect.
 *
 * refreshModelsEffect and dispatchCommandEventEffect use granular services
 * (DaemonSessionService / DaemonAgentProcessManagerService).
 * startCommandLoopEffect uses granular services.
 *
 * Because the Effect twins delegate to same-module functions via closure
 * (not module exports), tests verify behavior through observable side effects
 * rather than mock call-count assertions on the wrapped functions.
 */

import type { Layer } from 'effect';
import { Effect, Runtime } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import type {
  DaemonAgentProcessManagerService,
  DaemonMutableStateService,
  DaemonSessionService,
} from './daemon-services.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { DaemonSessionInit } from './types.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../api.js', () => ({
  api: {
    machines: {
      getCommandEvents: 'mock-getCommandEvents',
      ackPing: 'mock-ackPing',
      updateDaemonStatus: 'mock-updateDaemonStatus',
      register: 'mock-register',
      getObservedChatroomsForMachine: 'mock-getObservedChatroomsForMachine',
      daemonHeartbeat: 'mock-daemonHeartbeat',
      refreshCapabilities: 'mock-refreshCapabilities',
      reportFolderPickerResult: 'mock-reportFolderPickerResult',
    },
    workspaces: {
      upsertWorkspaceGitState: 'mock-upsertWorkspaceGitState',
      upsertRecentCommits: 'mock-upsertRecentCommits',
      getPendingRequests: 'mock-getPendingRequests',
      resetProcessingRequests: 'mock-resetProcessingRequests',
    },
    workspaceFiles: {
      getPendingDirListingRequests: 'mock-getPendingDirListingRequests',
      getPendingFileSearchRequests: 'mock-getPendingFileSearchRequests',
      getPendingFileContentRequests: 'mock-getPendingFileContentRequests',
    },
    commands: {
      syncCommands: 'mock-syncCommands',
    },
  },
}));

vi.mock('../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test-convex-url',
  getConvexWsClient: vi.fn().mockResolvedValue({
    onUpdate: vi.fn().mockReturnValue(vi.fn()),
  }),
}));

vi.mock('@workspace/backend/config/featureFlags.js', () => ({
  featureFlags: {
    directHarnessWorkers: false,
  },
}));

vi.mock('@workspace/backend/config/reliability.js', () => ({
  // Keep short in tests — production DAEMON_HEARTBEAT_INTERVAL_MS is 5 min.
  DAEMON_HEARTBEAT_INTERVAL_MS: 30_000,
  AGENT_REQUEST_DEADLINE_MS: 60_000,
  OBSERVED_FULL_PUSH_INTERVAL_MS: 60_000,
  OBSERVED_SAFETY_POLL_MS: 5_000,
  OBSERVATION_TTL_MS: 30_000,
  WORKSPACE_LIST_RECONCILE_MS: 30_000,
  WORKSPACE_RECENCY_WINDOW_MS: 60_000,
}));

vi.mock('../../../infrastructure/local-actions/pick-folder.js', () => ({
  pickFolderDialog: vi.fn(() => ({ success: true, path: '/tmp/picked-folder' })),
}));

vi.mock('../../../infrastructure/git/git-reader.js', () => ({
  isGitRepo: vi.fn().mockResolvedValue(false),
  getBranch: vi.fn().mockResolvedValue({ status: 'not_found' }),
  getRecentCommits: vi.fn().mockResolvedValue([]),
}));

vi.mock('./workspace-cache.js', () => ({
  getWorkspacesForMachine: vi.fn().mockResolvedValue([]),
}));

// refreshModels internals — intercepted because the Effect twin calls the
// same-module function which uses these via static import bindings.
vi.mock('./init.js', () => ({
  discoverModels: vi.fn().mockResolvedValue({ opencode: ['opencode/model-a'] }),
}));

vi.mock('../../../infrastructure/machine/index.js', () => ({
  ensureMachineRegistered: vi.fn().mockResolvedValue({
    machineId: 'test-machine-id',
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: [],
    harnessVersions: {},
  }),
}));

// startCommandLoop startup helpers — errors are swallowed with .catch(()=>{})
// but mocking keeps tests fast and avoids real I/O.
vi.mock('./git-heartbeat.js', async () => {
  const { Effect } = await import('effect');
  return {
    pushGitState: vi.fn().mockResolvedValue(undefined),
    pushSingleWorkspaceGitState: vi.fn().mockResolvedValue(undefined),
    pushGitStateEffect: Effect.void,
    pushSingleWorkspaceGitStateEffect: vi.fn().mockReturnValue(Effect.void),
  };
});

vi.mock('./command-sync-heartbeat.js', async () => {
  const { Effect } = await import('effect');
  return {
    pushCommands: vi.fn().mockResolvedValue(undefined),
    pushCommandsEffect: Effect.void,
  };
});

vi.mock('./commit-detail-sync.js', async () => {
  const { Effect } = await import('effect');
  return {
    syncCommitDetails: vi.fn().mockResolvedValue(undefined),
    syncCommitDetailsEffect: () => Effect.void, // factory form — production calls syncCommitDetailsEffect()
  };
});

// startCommandLoop subscription starters — each calls wsClient.onUpdate and
// returns { stop: () => void }. Mocking prevents transitive import issues.
vi.mock('./git-subscription.js', async () => {
  const { Effect } = await import('effect');
  return {
    startGitRequestSubscriptionEffect: () => Effect.succeed({ stop: vi.fn() }),
  };
});

vi.mock('./file-content-subscription.js', async () => {
  const { Effect } = await import('effect');
  return {
    startFileContentSubscriptionEffect: () => Effect.succeed({ stop: vi.fn() }),
  };
});

vi.mock('./file-tree-subscription.js', async () => {
  const { Effect } = await import('effect');
  return {
    startFileTreeSubscriptionEffect: () => Effect.succeed({ stop: vi.fn() }),
  };
});

vi.mock('./workspace-list-subscription.js', async () => {
  const { Effect } = await import('effect');
  return {
    startWorkspaceListSubscriptionEffect: () => Effect.succeed({ stop: vi.fn() }),
  };
});

vi.mock('./observed-sync.js', async () => {
  const { Effect } = await import('effect');
  return {
    startObservedSyncSubscriptionEffect: () => Effect.succeed({ stop: vi.fn() }),
  };
});

vi.mock('./handlers/process/log-observer-sync.js', () => ({
  startLogObserverSubscription: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('./handlers/ping.js', () => ({
  handlePing: vi.fn().mockReturnValue({ result: 'pong', failed: false }),
}));

vi.mock('../../../events/daemon/agent/on-request-start-agent.js', async () => {
  const { Effect } = await import('effect');
  return {
    onRequestStartAgent: vi.fn().mockResolvedValue(undefined),
    onRequestStartAgentEffect: vi.fn().mockReturnValue(Effect.void),
  };
});

vi.mock('../../../events/daemon/agent/on-request-stop-agent.js', async () => {
  const { Effect } = await import('effect');
  return {
    onRequestStopAgent: vi.fn().mockResolvedValue(undefined),
    onRequestStopAgentEffect: vi.fn().mockReturnValue(Effect.void),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Combined DaemonSessionService + DaemonAgentProcessManagerService + DaemonMutableStateService layers — used by dispatchCommandEventEffect and startCommandLoopEffect. */
function makeDispatchLayers(
  overrides?: Partial<DaemonSessionInit>
): Layer.Layer<
  DaemonSessionService | DaemonAgentProcessManagerService | DaemonMutableStateService
> {
  const init = createMockDaemonSessionInit(overrides);
  return daemonSessionToLayers(init);
}

async function runDispatch<A>(
  effect: Effect.Effect<
    A,
    never,
    DaemonSessionService | DaemonAgentProcessManagerService | DaemonMutableStateService
  >,
  overrides?: Partial<DaemonSessionInit>
) {
  return Effect.runPromise(effect.pipe(Effect.provide(makeDispatchLayers(overrides))));
}

/** DaemonSessionService layer — used by section A (refreshModelsEffect, E5+). */
function makeSessionLayer(
  overrides?: Partial<DaemonSessionInit>
): Layer.Layer<DaemonSessionService | DaemonMutableStateService> {
  const init = createMockDaemonSessionInit(overrides);
  return daemonSessionToLayers(init);
}

async function runWithSession<A>(
  effect: Effect.Effect<A, never, DaemonSessionService | DaemonMutableStateService>,
  overrides?: Partial<DaemonSessionInit>
) {
  return Effect.runPromise(effect.pipe(Effect.provide(makeSessionLayer(overrides))));
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

/** Build a fresh DedupTracker with all maps empty. */
function createDedupTracker() {
  return {
    commandIds: new Map<string, number>(),
    pingIds: new Map<string, number>(),
    gitRefreshIds: new Map<string, number>(),
    capabilitiesRefreshIds: new Map<string, number>(),
    localActionIds: new Map<string, number>(),
    pickFolderIds: new Map<string, number>(),
    commandRunIds: new Map<string, number>(),
    commandStopIds: new Map<string, number>(),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// ---------------------------------------------------------------------------
// A. refreshModelsEffect (E5.2 — DaemonSessionService)
// ---------------------------------------------------------------------------

describe('refreshModelsEffect', () => {
  it('returns noop when session.config is null (session injected from DaemonSessionService)', async () => {
    const { refreshModelsEffect } = await import('./models-refresh.js');
    // Default mock context has config: null → refreshModelsEffect short-circuits immediately.
    // Verifies the Effect extracted session from DaemonSessionService and executed correctly.
    const result = await runWithSession(refreshModelsEffect);

    expect(result).toEqual({ kind: 'noop' });
  });

  it('returns pushed when session has a valid config and there is no prior model snapshot', async () => {
    const { refreshModelsEffect } = await import('./models-refresh.js');
    const deps = createMockDaemonDeps();
    // discoverModels mock returns { opencode: ['opencode/model-a'] }.
    // lastPushedModels: null → prev={}, next has models → hasChanges=true → pushed.
    const config = {
      machineId: 'test-machine-id',
      hostname: 'test-host',
      os: 'darwin',
      registeredAt: '2026-01-01T00:00:00Z',
      lastSyncedAt: '2026-01-01T00:00:00Z',
      availableHarnesses: [] as any[],
      harnessVersions: {},
    } as any;

    const result = await runWithSession(
      refreshModelsEffect,
      withDeps(deps, { config, lastPushedModels: null, lastPushedHarnessFingerprint: null })
    );

    expect(result.kind).toBe('pushed');
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'mock-refreshCapabilities',
      expect.objectContaining({ machineId: 'test-machine-id' })
    );
  });

  it('returns skipped_no_changes when discovered models match the prior snapshot', async () => {
    const { refreshModelsEffect } = await import('./models-refresh.js');
    const deps = createMockDaemonDeps();
    // discoverModels mock returns { opencode: ['opencode/model-a'] }.
    // lastPushedModels already has that exact set → diff is empty → skipped.
    const config = {
      machineId: 'test-machine-id',
      hostname: 'test-host',
      os: 'darwin',
      registeredAt: '2026-01-01T00:00:00Z',
      lastSyncedAt: '2026-01-01T00:00:00Z',
      availableHarnesses: [] as any[],
      harnessVersions: {},
    } as any;

    const result = await runWithSession(
      refreshModelsEffect,
      withDeps(deps, {
        config,
        lastPushedModels: { opencode: ['opencode/model-a'] },
        lastPushedHarnessFingerprint: null,
      })
    );

    expect(result).toEqual({ kind: 'skipped_no_changes' });
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// B. dispatchCommandEventEffect
// ---------------------------------------------------------------------------

describe('dispatchCommandEventEffect', () => {
  it('processes daemon.ping and calls ackPing mutation (ctx from DaemonSessionService)', async () => {
    const { dispatchCommandEventEffect } = await import('./command-loop.js');
    const deps = createMockDaemonDeps();
    const event = { _id: 'evt-d5-ping-1', type: 'daemon.ping' } as any;
    const tracker = createDedupTracker();

    await runDispatch(dispatchCommandEventEffect(event, tracker), withDeps(deps));

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'mock-ackPing',
      expect.objectContaining({ sessionId: 'test-session-id', machineId: 'test-machine-id' })
    );
  });

  it('passes machineId from DaemonSessionService to the ackPing mutation', async () => {
    const { dispatchCommandEventEffect } = await import('./command-loop.js');
    const deps = createMockDaemonDeps();
    const event = { _id: 'evt-d5-ping-2', type: 'daemon.ping' } as any;
    const tracker = createDedupTracker();

    await runDispatch(
      dispatchCommandEventEffect(event, tracker),
      withDeps(deps, { machineId: 'machine-dispatch' })
    );

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'mock-ackPing',
      expect.objectContaining({ machineId: 'machine-dispatch' })
    );
  });

  it('processes daemon.pickFolder and reports result to backend', async () => {
    const { dispatchCommandEventEffect } = await import('./command-loop.js');
    const { pickFolderDialog } =
      await import('../../../infrastructure/local-actions/pick-folder.js');
    const deps = createMockDaemonDeps();
    const requestId = 'req-pick-folder-1';
    const event = { _id: 'evt-d5-pick-folder-1', type: 'daemon.pickFolder', requestId } as any;
    const tracker = createDedupTracker();

    await runDispatch(dispatchCommandEventEffect(event, tracker), withDeps(deps));

    expect(pickFolderDialog).toHaveBeenCalled();
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'mock-reportFolderPickerResult',
      expect.objectContaining({
        sessionId: 'test-session-id',
        machineId: 'test-machine-id',
        requestId,
        status: 'completed',
        selectedPath: '/tmp/picked-folder',
      })
    );
    expect(tracker.pickFolderIds.has('evt-d5-pick-folder-1')).toBe(true);
  });

  it('deduplicates daemon.pickFolder events by event id', async () => {
    const { dispatchCommandEventEffect } = await import('./command-loop.js');
    const { pickFolderDialog } =
      await import('../../../infrastructure/local-actions/pick-folder.js');
    const deps = createMockDaemonDeps();
    const event = {
      _id: 'evt-d5-pick-folder-dup',
      type: 'daemon.pickFolder',
      requestId: 'req-pick-folder-dup',
    } as any;
    const tracker = createDedupTracker();
    tracker.pickFolderIds.set('evt-d5-pick-folder-dup', Date.now());

    await runDispatch(dispatchCommandEventEffect(event, tracker), withDeps(deps));

    expect(pickFolderDialog).not.toHaveBeenCalled();
    expect(deps.backend.mutation).not.toHaveBeenCalledWith(
      'mock-reportFolderPickerResult',
      expect.anything()
    );
  });
});

// ---------------------------------------------------------------------------
// C. startCommandLoopEffect
// ---------------------------------------------------------------------------

describe('startCommandLoopEffect', () => {
  it('connects to Convex and starts the command loop (granular services)', async () => {
    const { startCommandLoopEffect } = await import('./command-loop.js');
    const { getConvexWsClient } = await import('../../../infrastructure/convex/client.js');

    // startCommandLoop returns Promise<never> — race against a timer so the test
    // can assert that setup ran without waiting forever.
    await Promise.race([
      Effect.runPromise(startCommandLoopEffect.pipe(Effect.provide(makeDispatchLayers()))),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 200);
        t.unref?.();
      }),
    ]);

    expect(getConvexWsClient).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // D. Phase 5: Heartbeat fiber isolation
  // ---------------------------------------------------------------------------

  describe('Phase 5: Heartbeat fiber isolation', () => {
    it('Runtime.runFork fires effects as daemon fibers that do not block caller', async () => {
      // Pattern-level test: Runtime.runFork is used elsewhere in the daemon for
      // non-blocking effect dispatch (e.g. shutdown paths). Verifies the fiber
      // completes in the background without blocking the caller.

      let fiberCompleted = false;
      let callerContinued = false;

      const slowEffect = Effect.promise<void>(
        () => new Promise((resolve) => setTimeout(resolve, 300))
      ).pipe(
        Effect.tap(
          Effect.sync(() => {
            fiberCompleted = true;
          })
        )
      );

      const testEffect = Effect.gen(function* () {
        const runtime = yield* Effect.runtime<never>();

        Runtime.runFork(runtime)(slowEffect);

        callerContinued = true;

        expect(callerContinued).toBe(true);
        expect(fiberCompleted).toBe(false);

        yield* Effect.promise<void>(() => new Promise((resolve) => setTimeout(resolve, 350)));
        expect(fiberCompleted).toBe(true);

        return Effect.void;
      });

      await Effect.runPromise(testEffect);
    });

    it('heartbeat callback only calls daemonHeartbeat mutation (no sync fork)', async () => {
      vi.useFakeTimers();
      try {
        const { startCommandLoopEffect } = await import('./command-loop.js');
        const deps = createMockDaemonDeps();
        const daemonHeartbeat = vi.fn().mockResolvedValue({ success: true });
        deps.backend.mutation = daemonHeartbeat;

        const loopPromise = Effect.runPromise(
          startCommandLoopEffect.pipe(Effect.provide(makeDispatchLayers(withDeps(deps))))
        );

        await vi.advanceTimersByTimeAsync(30_000);

        expect(daemonHeartbeat).toHaveBeenCalledWith(
          'mock-daemonHeartbeat',
          expect.objectContaining({
            sessionId: 'test-session-id',
            machineId: 'test-machine-id',
          })
        );

        loopPromise.catch(() => {});
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
