/**
 * Daemon Command Loop Effect Tests (Phase D5)
 *
 * Tests for the Effect twins of command-loop functions:
 *   refreshModelsEffect, dispatchCommandEventEffect, startCommandLoopEffect.
 *
 * All Effect twins require DaemonContextService.
 *
 * Because the Effect twins delegate to same-module functions via closure
 * (not module exports), tests verify behavior through observable side effects
 * rather than mock call-count assertions on the wrapped functions.
 */

import { Effect, Layer } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonContextService } from './daemon-context-service.js';
import { createMockDaemonContext } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { DaemonContext } from './types.js';

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
    },
    workspaces: {
      upsertWorkspaceGitState: 'mock-upsertWorkspaceGitState',
      upsertRecentCommits: 'mock-upsertRecentCommits',
      getPendingRequests: 'mock-getPendingRequests',
      resetProcessingRequests: 'mock-resetProcessingRequests',
    },
    workspaceFiles: {
      getPendingFileTreeRequests: 'mock-getPendingFileTreeRequests',
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
  DAEMON_HEARTBEAT_INTERVAL_MS: 30_000,
  AGENT_REQUEST_DEADLINE_MS: 60_000,
  OBSERVED_FULL_PUSH_INTERVAL_MS: 60_000,
  OBSERVED_SAFETY_POLL_MS: 5_000,
  OBSERVATION_TTL_MS: 30_000,
  WORKSPACE_LIST_RECONCILE_MS: 30_000,
  WORKSPACE_RECENCY_WINDOW_MS: 60_000,
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
vi.mock('./git-heartbeat.js', () => ({
  pushGitState: vi.fn().mockResolvedValue(undefined),
  pushSingleWorkspaceGitState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./command-sync-heartbeat.js', () => ({
  pushCommands: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./commit-detail-sync.js', () => ({
  syncCommitDetails: vi.fn().mockResolvedValue(undefined),
}));

// startCommandLoop subscription starters — each calls wsClient.onUpdate and
// returns { stop: () => void }. Mocking prevents transitive import issues.
vi.mock('./git-subscription.js', () => ({
  startGitRequestSubscription: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('./file-content-subscription.js', () => ({
  startFileContentSubscription: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('./file-tree-subscription.js', () => ({
  startFileTreeSubscription: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('./workspace-list-subscription.js', () => ({
  startWorkspaceListSubscription: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('./observed-sync.js', () => ({
  startObservedSyncSubscription: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('./handlers/process/log-observer-sync.js', () => ({
  startLogObserverSubscription: vi.fn().mockReturnValue({ stop: vi.fn() }),
}));

vi.mock('./handlers/ping.js', () => ({
  handlePing: vi.fn().mockReturnValue({ result: 'pong', failed: false }),
}));

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

/** Build a fresh DedupTracker with all maps empty. */
function createDedupTracker() {
  return {
    commandIds: new Map<string, number>(),
    pingIds: new Map<string, number>(),
    gitRefreshIds: new Map<string, number>(),
    capabilitiesRefreshIds: new Map<string, number>(),
    localActionIds: new Map<string, number>(),
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
// A. refreshModelsEffect
// ---------------------------------------------------------------------------

describe('refreshModelsEffect', () => {
  it('returns noop when ctx.config is null (ctx injected from DaemonContextService)', async () => {
    const { refreshModelsEffect } = await import('./command-loop.js');
    // Default mock context has config: null → refreshModels short-circuits immediately.
    // Verifies the Effect twin extracted ctx from DaemonContextService and delegated correctly.
    const result = await runWithCtx(refreshModelsEffect);

    expect(result).toEqual({ kind: 'noop' });
  });

  it('returns pushed when ctx has a valid config and there is no prior model snapshot', async () => {
    const { refreshModelsEffect } = await import('./command-loop.js');
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

    const result = await runWithCtx(refreshModelsEffect, {
      deps,
      config,
      lastPushedModels: null,
      lastPushedHarnessFingerprint: null,
    });

    expect(result).toEqual({ kind: 'pushed' });
    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'mock-refreshCapabilities',
      expect.objectContaining({ machineId: 'test-machine-id' })
    );
  });

  it('returns skipped_no_changes when discovered models match the prior snapshot', async () => {
    const { refreshModelsEffect } = await import('./command-loop.js');
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

    const result = await runWithCtx(refreshModelsEffect, {
      deps,
      config,
      lastPushedModels: { opencode: ['opencode/model-a'] },
      lastPushedHarnessFingerprint: null, // null → harnessFingerprintChanged=false
    });

    expect(result).toEqual({ kind: 'skipped_no_changes' });
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// B. dispatchCommandEventEffect
// ---------------------------------------------------------------------------

describe('dispatchCommandEventEffect', () => {
  it('processes daemon.ping and calls ackPing mutation with ctx from DaemonContextService', async () => {
    const { dispatchCommandEventEffect } = await import('./command-loop.js');
    const deps = createMockDaemonDeps();
    const event = { _id: 'evt-d5-ping-1', type: 'daemon.ping' } as any;
    const tracker = createDedupTracker();

    await runWithCtx(dispatchCommandEventEffect(event, tracker), { deps });

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'mock-ackPing',
      expect.objectContaining({ sessionId: 'test-session-id', machineId: 'test-machine-id' })
    );
  });

  it('passes machineId from DaemonContextService ctx to the ackPing mutation', async () => {
    const { dispatchCommandEventEffect } = await import('./command-loop.js');
    const deps = createMockDaemonDeps();
    const event = { _id: 'evt-d5-ping-2', type: 'daemon.ping' } as any;
    const tracker = createDedupTracker();

    await runWithCtx(dispatchCommandEventEffect(event, tracker), {
      deps,
      machineId: 'machine-dispatch',
    });

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      'mock-ackPing',
      expect.objectContaining({ machineId: 'machine-dispatch' })
    );
  });
});

// ---------------------------------------------------------------------------
// C. startCommandLoopEffect
// ---------------------------------------------------------------------------

describe('startCommandLoopEffect', () => {
  it('connects to Convex and starts the command loop (ctx injected from DaemonContextService)', async () => {
    const { startCommandLoopEffect } = await import('./command-loop.js');
    const { getConvexWsClient } = await import('../../../infrastructure/convex/client.js');

    // startCommandLoop returns Promise<never> — race against a timer so the test
    // can assert that setup ran without waiting forever.
    await Promise.race([
      Effect.runPromise(
        (startCommandLoopEffect as Effect.Effect<any, never, DaemonContextService>).pipe(
          Effect.provide(makeLayer())
        )
      ),
      new Promise<void>((resolve) => {
        const t = setTimeout(resolve, 200);
        t.unref?.();
      }),
    ]);

    expect(getConvexWsClient).toHaveBeenCalled();
  });
});
