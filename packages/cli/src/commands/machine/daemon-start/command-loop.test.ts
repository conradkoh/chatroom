/**
 * command-loop Unit Tests
 *
 * Tests the refreshModels function using injected dependencies.
 *
 * Note: startCommandLoop is not tested here because it involves
 * WebSocket subscriptions, timers, and signal handlers. The individual
 * event handlers it dispatches to are tested in their own test files.
 * processCommand was removed in Phase D — commands now arrive via event
 * stream and are handled directly in the stream subscription.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { harnessCapabilitiesFingerprint } from './capabilities-snapshot.js';
import { dispatchCommandEvent, refreshModels } from './command-loop.js';
import type { DaemonDeps } from './deps.js';
import { pushGitState } from './git-heartbeat.js';
import { onCommandRun, onCommandStop } from './handlers/command-runner.js';
import { handlePing } from './handlers/ping.js';
import type { DaemonContext, AgentHarness } from './types.js';
import { onRequestStartAgent } from '../../../events/daemon/agent/on-request-start-agent.js';
import { onRequestStopAgent } from '../../../events/daemon/agent/on-request-stop-agent.js';
import { DaemonEventBus } from '../../../events/daemon/event-bus.js';
import { executeLocalAction } from '../../../infrastructure/local-actions/index.js';
import type { RemoteAgentService } from '../../../infrastructure/services/remote-agents/remote-agent-service.js';

// ---------------------------------------------------------------------------
// Module mocks for dispatchCommandEvent tests
// ---------------------------------------------------------------------------

vi.mock('../../../events/daemon/agent/on-request-start-agent.js', () => ({
  onRequestStartAgent: vi.fn(),
}));

vi.mock('../../../events/daemon/agent/on-request-stop-agent.js', () => ({
  onRequestStopAgent: vi.fn(),
}));

vi.mock('./handlers/ping.js', () => ({
  handlePing: vi.fn(),
}));

vi.mock('./handlers/command-runner.js', () => ({
  onCommandRun: vi.fn(),
  onCommandStop: vi.fn(),
  evictStalePendingStops: vi.fn(),
}));

vi.mock('./git-heartbeat.js', () => ({
  pushGitState: vi.fn(),
  pushSingleWorkspaceGitSummaryForObserved: vi.fn(),
}));

vi.mock('../../../infrastructure/local-actions/index.js', () => ({
  executeLocalAction: vi.fn().mockResolvedValue({ success: true }),
}));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: () => 'http://test:3210',
  getConvexWsClient: vi.fn(),
}));

const { mockEnsureMachineRegistered } = vi.hoisted(() => ({
  mockEnsureMachineRegistered: vi.fn(() => ({
    machineId: 'test-machine-id',
    hostname: 'test-host',
    os: 'darwin',
    availableHarnesses: ['opencode', 'pi'],
    harnessVersions: {},
  })),
}));

vi.mock('../../../infrastructure/machine/index.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../../infrastructure/machine/index.js')>();
  return {
    ...mod,
    ensureMachineRegistered: mockEnsureMachineRegistered,
  };
});

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// refreshModels
// ---------------------------------------------------------------------------

describe('refreshModels', () => {
  function createContextWithServices(
    services: { harness: AgentHarness; isInstalled: boolean; models: string[] | Error }[]
  ): DaemonContext {
    const agentServices = new Map<AgentHarness, RemoteAgentService>(
      services.map(({ harness, isInstalled: installed, models }) => [
        harness,
        {
          isInstalled: vi.fn().mockReturnValue(installed),
          listModels:
            models instanceof Error
              ? vi.fn().mockRejectedValue(models)
              : vi.fn().mockResolvedValue(models),
        } as unknown as RemoteAgentService,
      ])
    );

    const deps: DaemonDeps = {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue(undefined),
      },
      processes: { kill: vi.fn() },
      fs: { stat: vi.fn() as any },
      machine: {
        clearAgentPid: vi.fn(),
        persistAgentPid: vi.fn(),
        listAgentEntries: vi.fn().mockReturnValue([]),
        persistEventCursor: vi.fn(),
        loadEventCursor: vi.fn().mockReturnValue(null),
      },
      clock: {
        now: vi.fn().mockReturnValue(Date.now()),
        delay: vi.fn().mockResolvedValue(undefined),
      },
      spawning: {
        shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
        recordSpawn: vi.fn(),
        recordExit: vi.fn(),
        getConcurrentCount: vi.fn().mockReturnValue(0),
      },
      agentProcessManager: {
        ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 12345 }),
        stop: vi.fn().mockResolvedValue({ success: true }),
        handleExit: vi.fn(),
        recover: vi.fn().mockResolvedValue(undefined),
        getSlot: vi.fn().mockReturnValue(undefined),
        listActive: vi.fn().mockReturnValue([]),
      } as any,
    };

    return {
      client: {} as any,
      sessionId: 'test-session-id',
      machineId: 'test-machine-id',
      config: {
        machineId: 'test-machine-id',
        hostname: 'test-host',
        os: 'darwin',
        registeredAt: '2026-01-01T00:00:00Z',
        lastSyncedAt: '2026-01-01T00:00:00Z',
        availableHarnesses: ['opencode', 'pi'],
        harnessVersions: {},
      },
      deps,
      events: new DaemonEventBus(),
      agentServices,
      lastPushedGitState: new Map(),
      // Default to `null` so each test starts from "no prior snapshot" — the
      // first refreshModels() call will detect everything as new and push.
      // Tests that exercise the diff/no-diff paths override this explicitly.
      lastPushedModels: null,
      lastPushedHarnessFingerprint: null,
    };
  }

  it('discovers models from all installed harnesses', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a', 'opencode/model-b'] },
      { harness: 'pi', isInstalled: true, models: ['github-copilot/claude-sonnet-4.5'] },
    ]);

    const outcome = await refreshModels(ctx);
    expect(outcome).toMatchObject({ kind: 'pushed' });

    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        availableModels: {
          opencode: ['opencode/model-a', 'opencode/model-b'],
          pi: ['github-copilot/claude-sonnet-4.5'],
        },
      })
    );
  });

  it('skips harnesses that are not installed — does not write empty entry', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
      { harness: 'pi', isInstalled: false, models: [] },
    ]);

    const outcome = await refreshModels(ctx);
    expect(outcome).toMatchObject({ kind: 'pushed' });

    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        availableModels: {
          opencode: ['opencode/model-a'],
          // pi must NOT be present — was not installed
        },
      })
    );
    const call = vi.mocked(ctx.deps.backend.mutation).mock.calls[0][1] as any;
    expect(call.availableModels).not.toHaveProperty('pi');
  });

  it('stores empty array when listModels throws (non-critical error)', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: new Error('opencode broke') },
      { harness: 'pi', isInstalled: true, models: ['github-copilot/gpt-4o'] },
    ]);

    const outcome = await refreshModels(ctx);
    expect(outcome).toMatchObject({ kind: 'pushed' });

    const call = vi.mocked(ctx.deps.backend.mutation).mock.calls[0][1] as any;
    // opencode failed — discoverModels() stores [] to distinguish "installed but
    // no models" from "not installed" (key absent)
    expect(call.availableModels).toHaveProperty('opencode', []);
    expect(call.availableModels).toEqual({ opencode: [], pi: ['github-copilot/gpt-4o'] });
  });

  it('does not call mutation when config is null', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
    ]);
    ctx.config = null;

    const outcome = await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'noop' });
  });

  it('warns but does not throw when mutation fails', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
    ]);
    vi.mocked(ctx.deps.backend.mutation).mockRejectedValueOnce(new Error('network error'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(refreshModels(ctx)).resolves.toEqual({
      kind: 'failed',
      message: 'network error',
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Model refresh failed'));
  });

  // ─── Diff-based push behavior ────────────────────────────────────────────

  it('skips backend mutation when discovered models match the previous snapshot', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a', 'opencode/model-b'] },
      { harness: 'pi', isInstalled: true, models: ['github-copilot/claude-sonnet-4.5'] },
    ]);
    // Seed snapshot with the same set the next discovery will return.
    ctx.lastPushedModels = {
      opencode: ['opencode/model-a', 'opencode/model-b'],
      pi: ['github-copilot/claude-sonnet-4.5'],
    };
    ctx.lastPushedHarnessFingerprint = harnessCapabilitiesFingerprint(['opencode', 'pi'], {});

    const outcome = await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'skipped_no_changes' });
  });

  it('treats reordered model lists as unchanged (set comparison, not array)', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['model-b', 'model-a'] },
    ]);
    ctx.lastPushedModels = { opencode: ['model-a', 'model-b'] };
    ctx.lastPushedHarnessFingerprint = harnessCapabilitiesFingerprint(['opencode', 'pi'], {});

    const outcome = await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).not.toHaveBeenCalled();
    expect(outcome).toEqual({ kind: 'skipped_no_changes' });
  });

  it('pushes when harness metadata changes even if models are unchanged', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
      { harness: 'pi', isInstalled: true, models: ['github-copilot/gpt-4o'] },
    ]);
    ctx.lastPushedModels = {
      opencode: ['opencode/model-a'],
      pi: ['github-copilot/gpt-4o'],
    };
    ctx.lastPushedHarnessFingerprint = harnessCapabilitiesFingerprint(['opencode'], {});

    const outcome = await refreshModels(ctx);

    expect(outcome).toMatchObject({ kind: 'pushed' });
    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(1);
    expect(ctx.lastPushedHarnessFingerprint).toBe(
      harnessCapabilitiesFingerprint(['opencode', 'pi'], {})
    );
  });

  it('logs newly detected models and pushes when models are added', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a', 'opencode/model-b'] },
    ]);
    ctx.lastPushedModels = { opencode: ['opencode/model-a'] };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(1);
    const additionLog = logSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('New models detected')
    );
    expect(additionLog?.[0]).toContain('opencode/model-b');
    expect(additionLog?.[0]).not.toContain('opencode/model-a'); // pre-existing, not "new"
  });

  it('logs removed models and pushes when models disappear', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
    ]);
    ctx.lastPushedModels = { opencode: ['opencode/model-a', 'opencode/model-gone'] };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(1);
    const removalLog = logSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('no longer available')
    );
    expect(removalLog?.[0]).toContain('opencode/model-gone');
  });

  it('detects a wholly new harness as added', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a'] },
      { harness: 'pi', isInstalled: true, models: ['github-copilot/gpt-4o'] },
    ]);
    // Previous snapshot only had opencode — pi is entirely new.
    ctx.lastPushedModels = { opencode: ['opencode/model-a'] };
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await refreshModels(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledTimes(1);
    const additionLog = logSpy.mock.calls.find(
      (args) => typeof args[0] === 'string' && args[0].includes('New models detected')
    );
    expect(additionLog?.[0]).toContain('pi:');
    expect(additionLog?.[0]).toContain('github-copilot/gpt-4o');
  });

  it('updates the snapshot only after a successful push', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a', 'opencode/model-b'] },
    ]);
    ctx.lastPushedModels = { opencode: ['opencode/model-a'] };

    await refreshModels(ctx);

    expect(ctx.lastPushedModels).toEqual({
      opencode: ['opencode/model-a', 'opencode/model-b'],
    });
    expect(ctx.lastPushedHarnessFingerprint).toBe(
      harnessCapabilitiesFingerprint(['opencode', 'pi'], {})
    );
  });

  it('leaves the snapshot unchanged when the backend mutation fails (next tick will retry)', async () => {
    const ctx = createContextWithServices([
      { harness: 'opencode', isInstalled: true, models: ['opencode/model-a', 'opencode/model-b'] },
    ]);
    const previous = { opencode: ['opencode/model-a'] };
    ctx.lastPushedModels = previous;
    const prevFp = harnessCapabilitiesFingerprint(['opencode', 'pi'], {});
    ctx.lastPushedHarnessFingerprint = prevFp;
    vi.mocked(ctx.deps.backend.mutation).mockRejectedValueOnce(new Error('network error'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const outcome = await refreshModels(ctx);

    // Snapshot must NOT be advanced — otherwise the addition would be lost
    // and the next tick would compare the new set against itself and skip.
    expect(ctx.lastPushedModels).toBe(previous);
    expect(ctx.lastPushedHarnessFingerprint).toBe(prevFp);
    expect(outcome).toEqual({ kind: 'failed', message: 'network error' });
  });
});

// ---------------------------------------------------------------------------
// dispatchCommandEvent — dedup-after-handler invariant tests
// ---------------------------------------------------------------------------

/**
 * Build a minimal DedupTracker fixture with all maps empty.
 * Matches the DedupTracker interface in command-loop.ts (structural typing).
 */
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

/**
 * Minimal DaemonContext sufficient for the dispatcher.
 * The handlers themselves are mocked, so we only need sessionId/machineId
 * and a backend stub (for daemon.ping's ackPing call and daemon.gitRefresh).
 */
function createDispatchCtx(): DaemonContext {
  const deps: DaemonDeps = {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
    },
    processes: { kill: vi.fn() },
    fs: { stat: vi.fn() as any },
    machine: {
      clearAgentPid: vi.fn(),
      persistAgentPid: vi.fn(),
      listAgentEntries: vi.fn().mockReturnValue([]),
      persistEventCursor: vi.fn(),
      loadEventCursor: vi.fn().mockReturnValue(null),
    },
    clock: {
      now: vi.fn().mockReturnValue(Date.now()),
      delay: vi.fn().mockResolvedValue(undefined),
    },
    spawning: {
      shouldAllowSpawn: vi.fn().mockReturnValue({ allowed: true }),
      recordSpawn: vi.fn(),
      recordExit: vi.fn(),
      getConcurrentCount: vi.fn().mockReturnValue(0),
    },
    agentProcessManager: {
      ensureRunning: vi.fn().mockResolvedValue({ success: true, pid: 12345 }),
      stop: vi.fn().mockResolvedValue({ success: true }),
      handleExit: vi.fn(),
      recover: vi.fn().mockResolvedValue(undefined),
      getSlot: vi.fn().mockReturnValue(undefined),
      listActive: vi.fn().mockReturnValue([]),
    } as any,
  };

  return {
    client: {} as any,
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null, // null causes refreshModels to return noop without spawning
    deps,
    events: new DaemonEventBus(),
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
  };
}

/** Build a minimal fake event with the given type and id. */
function makeEvent(type: string, id: string, extra?: Record<string, unknown>) {
  return { _id: id as any, type, ...extra } as any;
}

describe('dispatchCommandEvent', () => {
  let ctx: DaemonContext;
  let tracker: ReturnType<typeof createDedupTracker>;

  beforeEach(() => {
    ctx = createDispatchCtx();
    tracker = createDedupTracker();
    // Reset all handler mocks between tests
    vi.mocked(onRequestStartAgent).mockReset();
    vi.mocked(onRequestStopAgent).mockReset();
    vi.mocked(handlePing).mockReset();
    vi.mocked(onCommandRun).mockReset();
    vi.mocked(onCommandStop).mockReset();
    vi.mocked(pushGitState).mockReset();
    vi.mocked(executeLocalAction).mockReset();
  });

  // ── agent.requestStart ──────────────────────────────────────────────────

  it('agent.requestStart: sets dedup ID after successful handler', async () => {
    vi.mocked(onRequestStartAgent).mockResolvedValue(undefined);
    const event = makeEvent('agent.requestStart', 'evt-start-ok', {
      chatroomId: 'room-1',
      role: 'builder',
      agentHarness: 'pi',
      model: 'gpt-4',
      workingDir: '/tmp',
      reason: 'user.start',
      deadline: Date.now() + 60_000,
    });

    await dispatchCommandEvent(ctx, event, tracker);

    expect(tracker.commandIds.has('evt-start-ok')).toBe(true);
  });

  it('agent.requestStart: does NOT set dedup ID when handler throws (enables retry)', async () => {
    vi.mocked(onRequestStartAgent).mockRejectedValue(new Error('transient'));
    const event = makeEvent('agent.requestStart', 'evt-start-fail');

    await expect(dispatchCommandEvent(ctx, event, tracker)).rejects.toThrow('transient');

    expect(tracker.commandIds.has('evt-start-fail')).toBe(false);
  });

  // ── agent.requestStop ───────────────────────────────────────────────────

  it('agent.requestStop: sets dedup ID after successful handler', async () => {
    vi.mocked(onRequestStopAgent).mockResolvedValue(undefined);
    const event = makeEvent('agent.requestStop', 'evt-stop-ok');

    await dispatchCommandEvent(ctx, event, tracker);

    expect(tracker.commandIds.has('evt-stop-ok')).toBe(true);
  });

  it('agent.requestStop: does NOT set dedup ID when handler throws (enables retry)', async () => {
    vi.mocked(onRequestStopAgent).mockRejectedValue(new Error('transient'));
    const event = makeEvent('agent.requestStop', 'evt-stop-fail');

    await expect(dispatchCommandEvent(ctx, event, tracker)).rejects.toThrow('transient');

    expect(tracker.commandIds.has('evt-stop-fail')).toBe(false);
  });

  // ── daemon.ping ─────────────────────────────────────────────────────────

  it('daemon.ping: sets dedup ID after successful handler', async () => {
    vi.mocked(handlePing).mockReturnValue({ result: 'pong', failed: false });
    (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    const event = makeEvent('daemon.ping', 'evt-ping-ok');

    await dispatchCommandEvent(ctx, event, tracker);

    expect(tracker.pingIds.has('evt-ping-ok')).toBe(true);
  });

  it('daemon.ping: does NOT set dedup ID when ackPing mutation throws (enables retry)', async () => {
    vi.mocked(handlePing).mockReturnValue({ result: 'pong', failed: false });
    (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('backend down')
    );
    const event = makeEvent('daemon.ping', 'evt-ping-fail');

    await expect(dispatchCommandEvent(ctx, event, tracker)).rejects.toThrow('backend down');

    expect(tracker.pingIds.has('evt-ping-fail')).toBe(false);
  });

  // ── daemon.gitRefresh ────────────────────────────────────────────────────

  it('daemon.gitRefresh: sets dedup ID after successful handler', async () => {
    vi.mocked(pushGitState).mockResolvedValue(undefined);
    const event = makeEvent('daemon.gitRefresh', 'evt-git-ok', { workingDir: '/tmp' });

    await dispatchCommandEvent(ctx, event, tracker);

    expect(tracker.gitRefreshIds.has('evt-git-ok')).toBe(true);
  });

  it('daemon.gitRefresh: does NOT set dedup ID when pushGitState throws (enables retry)', async () => {
    vi.mocked(pushGitState).mockRejectedValue(new Error('git error'));
    const event = makeEvent('daemon.gitRefresh', 'evt-git-fail', { workingDir: '/tmp' });

    await expect(dispatchCommandEvent(ctx, event, tracker)).rejects.toThrow('git error');

    expect(tracker.gitRefreshIds.has('evt-git-fail')).toBe(false);
  });

  // ── daemon.localAction ──────────────────────────────────────────────────

  it('daemon.localAction: sets dedup ID after successful handler', async () => {
    vi.mocked(executeLocalAction).mockResolvedValue({ success: true });
    const event = makeEvent('daemon.localAction', 'evt-local-ok', {
      action: 'open_vscode',
      workingDir: '/tmp',
    });

    await dispatchCommandEvent(ctx, event, tracker);

    expect(tracker.localActionIds.has('evt-local-ok')).toBe(true);
  });

  it('daemon.localAction: does NOT set dedup ID when handler throws (enables retry)', async () => {
    vi.mocked(executeLocalAction).mockRejectedValue(new Error('exec error'));
    const event = makeEvent('daemon.localAction', 'evt-local-fail', {
      action: 'open_vscode',
      workingDir: '/tmp',
    });

    await expect(dispatchCommandEvent(ctx, event, tracker)).rejects.toThrow('exec error');

    expect(tracker.localActionIds.has('evt-local-fail')).toBe(false);
  });

  // ── command.run (dedup-BEFORE-handler — non-idempotent spawn) ───────────

  it('command.run: sets dedup ID BEFORE handler so retry cannot spawn a duplicate', async () => {
    vi.mocked(onCommandRun).mockResolvedValue(undefined);
    const event = makeEvent('command.run', 'evt-run-ok');

    await dispatchCommandEvent(ctx, event, tracker);

    expect(tracker.commandRunIds.has('evt-run-ok')).toBe(true);
  });

  it('command.run: dedup ID IS set even when handler throws (prevents duplicate spawn on retry)', async () => {
    vi.mocked(onCommandRun).mockRejectedValue(new Error('spawn failed'));
    const event = makeEvent('command.run', 'evt-run-fail');

    await expect(dispatchCommandEvent(ctx, event, tracker)).rejects.toThrow('spawn failed');

    // Unlike other handlers, command.run registers dedup BEFORE the handler
    // so a throw does NOT clear the dedup ID — the event will NOT be retried.
    expect(tracker.commandRunIds.has('evt-run-fail')).toBe(true);
  });

  // ── command.stop ─────────────────────────────────────────────────────────

  it('command.stop: sets dedup ID after successful handler', async () => {
    vi.mocked(onCommandStop).mockResolvedValue(undefined);
    const event = makeEvent('command.stop', 'evt-cmdstop-ok');

    await dispatchCommandEvent(ctx, event, tracker);

    expect(tracker.commandStopIds.has('evt-cmdstop-ok')).toBe(true);
  });

  it('command.stop: does NOT set dedup ID when handler throws (enables retry)', async () => {
    vi.mocked(onCommandStop).mockRejectedValue(new Error('stop error'));
    const event = makeEvent('command.stop', 'evt-cmdstop-fail');

    await expect(dispatchCommandEvent(ctx, event, tracker)).rejects.toThrow('stop error');

    expect(tracker.commandStopIds.has('evt-cmdstop-fail')).toBe(false);
  });

  // ── daemon.refreshCapabilities ───────────────────────────────────────────

  it('daemon.refreshCapabilities: sets dedup ID after call (handler suppresses errors internally)', async () => {
    // ctx.config is null → refreshModels returns {kind:'noop'} without any backend call.
    // The handler catches all internal errors, so the dedup ID is always set.
    const event = makeEvent('daemon.refreshCapabilities', 'evt-caps-ok');

    await dispatchCommandEvent(ctx, event, tracker);

    expect(tracker.capabilitiesRefreshIds.has('evt-caps-ok')).toBe(true);
  });

  it('daemon.refreshCapabilities: dedup ID IS set even when refreshModels returns "failed" (handler never throws)', async () => {
    // When ctx.config is valid but backend throws, refreshModels catches it and
    // returns {kind:'failed'}. The handler still sets the dedup ID.
    ctx.config = {
      machineId: 'test-machine',
      hostname: 'test-host',
      os: 'darwin',
      registeredAt: '2026-01-01T00:00:00Z',
      lastSyncedAt: '2026-01-01T00:00:00Z',
      availableHarnesses: [],
      harnessVersions: {},
    };
    ctx.agentServices = new Map(); // empty → no models discovered
    ctx.lastPushedModels = null; // force a push attempt
    (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('backend error')
    );
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const event = makeEvent('daemon.refreshCapabilities', 'evt-caps-fail');

    await dispatchCommandEvent(ctx, event, tracker);

    // Handler caught the error internally; dedup ID is set
    expect(tracker.capabilitiesRefreshIds.has('evt-caps-fail')).toBe(true);
  });

  // ── Dedup short-circuit ─────────────────────────────────────────────────

  it('does not call handler when event ID is already in the dedup map', async () => {
    vi.mocked(onRequestStartAgent).mockResolvedValue(undefined);
    const event = makeEvent('agent.requestStart', 'already-seen');
    tracker.commandIds.set('already-seen', Date.now());

    await dispatchCommandEvent(ctx, event, tracker);

    expect(onRequestStartAgent).not.toHaveBeenCalled();
  });
});
