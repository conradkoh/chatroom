/**
 * command-runner Unit Tests
 *
 * Tests the public API of command-runner.ts:
 *   - shutdownAllCommands: kills all tracked processes on daemon shutdown
 *   - pending-stop race: onCommandStop registers + onCommandRun consumes
 *   - evictStalePendingStops: TTL-based eviction of stale pending-stop entries
 *   - timeout watchdog: process killed after 30-minute timeout
 *
 * Note: clearStaleCommandRuns is a Convex mutation and is OUT OF SCOPE for unit
 * tests here — there is no convex-test infrastructure for backend mutations in
 * this repo. It is tested manually / via integration tests against a real deployment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
}));

// Mock the convex api — mutation/query refs are just opaque tokens for the mock
vi.mock('../../../../api.js', () => ({
  api: {
    commands: {
      updateRunStatus: 'mock-updateRunStatus',
      appendOutput: 'mock-appendOutput',
    },
  },
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { spawn } from 'node:child_process';
import {
  onCommandRun,
  onCommandStop,
  shutdownAllCommands,
  evictStalePendingStops,
  runningProcesses, // @internal
  pendingStops,     // @internal
} from './command-runner.js';
import type { DaemonContext } from '../types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Minimal DaemonContext with a mocked backend. */
function createCtx(): DaemonContext {
  return {
    sessionId: 'test-session',
    machineId: 'test-machine',
    client: {} as any,
    config: null,
    deps: {
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
        ensureRunning: vi.fn(),
        stop: vi.fn(),
        handleExit: vi.fn(),
        recover: vi.fn(),
        getSlot: vi.fn(),
        listActive: vi.fn().mockReturnValue([]),
      } as any,
    },
    events: { emit: vi.fn() } as any,
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
  };
}

/**
 * Create a fake ChildProcess with pid, kill(), stdout, stderr, and event emitter
 * methods (on/emit). Returned object can be used as argument to vi.mocked(spawn).
 */
function createFakeChild(pid: number = 9999) {
  const exitEmitter = new EventEmitter();
  const child = {
    pid,
    kill: vi.fn(() => true),
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    on: exitEmitter.on.bind(exitEmitter),
    once: exitEmitter.once.bind(exitEmitter),
    emit: exitEmitter.emit.bind(exitEmitter),
    _emitter: exitEmitter, // test access
  };
  return child;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let ctx: DaemonContext;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let killSpy: any;

beforeEach(() => {
  ctx = createCtx();
  // Clear module-level state between tests
  runningProcesses.clear();
  pendingStops.clear();
  // Reset all mock call counts and implementations
  vi.clearAllMocks();
  // Spy on process.kill to prevent actually sending OS signals
  killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
  // Default spawn implementation — returns a new fake child per call
  vi.mocked(spawn).mockImplementation((): any => createFakeChild(Math.floor(Math.random() * 90000) + 10000));
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  // Re-configure the backend mock (cleared above) to default resolve
  vi.mocked(ctx.deps.backend.mutation).mockResolvedValue(undefined);
  vi.mocked(ctx.deps.backend.query).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  // Ensure no leftover state leaks between tests
  runningProcesses.clear();
  pendingStops.clear();
});

// ---------------------------------------------------------------------------
// A. shutdownAllCommands
// ---------------------------------------------------------------------------

describe('shutdownAllCommands', () => {
  it('is a no-op when no processes are running', async () => {
    await shutdownAllCommands(ctx);
    expect(killSpy).not.toHaveBeenCalled();
  });

  it('sends SIGTERM to each running process group and clears runningProcesses', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(9999);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-shutdown' as any,
      commandName: 'test',
      script: 'sleep 60',
      workingDir: '/tmp',
    });

    expect(runningProcesses.size).toBe(1);

    const shutdownPromise = shutdownAllCommands(ctx);
    // Advance past the 3-second grace period so the promise resolves
    await vi.advanceTimersByTimeAsync(4_000);
    await shutdownPromise;

    expect(killSpy).toHaveBeenCalledWith(-9999, 'SIGTERM');
    expect(runningProcesses.size).toBe(0);
  });

  it('force-kills with SIGKILL after grace period for SIGTERM-ignoring processes', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(8888);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-sigkill' as any,
      commandName: 'stubborn',
      script: 'sleep 60',
      workingDir: '/tmp',
    });

    const shutdownPromise = shutdownAllCommands(ctx);
    // Advance through SIGTERM phase
    await vi.advanceTimersByTimeAsync(4_000);
    await shutdownPromise;

    // SIGTERM was sent; since process.kill is mocked, process never actually died,
    // so runningProcesses still had the entry when SIGKILL was attempted.
    expect(killSpy).toHaveBeenCalledWith(-8888, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(-8888, 'SIGKILL');
    expect(runningProcesses.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// B. Pending-stop race
// ---------------------------------------------------------------------------

describe('pending-stop race (stop-before-run)', () => {
  it('registers a pending stop when no process is found for the runId', async () => {
    await onCommandStop(ctx, { runId: 'run-orphan' as any });
    expect(pendingStops.has('run-orphan')).toBe(true);
  });

  it('skips spawning when a pending stop exists for the runId', async () => {
    // Simulate stop arriving before run
    await onCommandStop(ctx, { runId: 'run-race' as any });
    expect(pendingStops.has('run-race')).toBe(true);

    // Now the run event arrives — should be skipped
    await onCommandRun(ctx, {
      runId: 'run-race' as any,
      commandName: 'should-not-spawn',
      script: 'echo hi',
      workingDir: '/tmp',
    });

    // spawn must NOT have been called
    expect(spawn).not.toHaveBeenCalled();
    // Pending stop entry consumed
    expect(pendingStops.has('run-race')).toBe(false);
    // Backend should have been called with 'stopped' (both from onCommandStop AND onCommandRun skip)
    const mutationCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls;
    const statusArgs = mutationCalls.map((c) => (c[1] as any)?.status);
    expect(statusArgs.filter((s) => s === 'stopped').length).toBeGreaterThanOrEqual(2);
  });

  it('proceeds with spawn when no pending stop exists for the runId', async () => {
    const fakeChild = createFakeChild(7777);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-normal' as any,
      commandName: 'normal',
      script: 'sleep 1',
      workingDir: '/tmp',
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(runningProcesses.has('run-normal')).toBe(true);
  });

  it('throws when backend mutation fails so dispatchCommandEvent can retry', async () => {
    // When the backend mutation for the orphan-stop path throws, onCommandStop re-throws
    // so that dispatchCommandEvent (dedup-after-handler) skips registering the dedup ID
    // and retries on the next subscription update.
    vi.mocked(ctx.deps.backend.mutation).mockRejectedValueOnce(new Error('Convex disconnect'));

    await expect(
      onCommandStop(ctx, { runId: 'run-orphan-fail' as any })
    ).rejects.toThrow('Convex disconnect');

    // Pending stop must still be registered (set before the mutation throw)
    // so the next onCommandRun for this runId is skipped (stop-before-run safety).
    expect(pendingStops.has('run-orphan-fail')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. evictStalePendingStops
// ---------------------------------------------------------------------------

describe('evictStalePendingStops', () => {
  it('evicts entries older than 60 seconds', () => {
    vi.useFakeTimers();
    const now = Date.now();
    pendingStops.set('old-run', now - 61_000); // 61 seconds old
    pendingStops.set('fresh-run', now - 5_000); // 5 seconds old — keep

    evictStalePendingStops();

    expect(pendingStops.has('old-run')).toBe(false);
    expect(pendingStops.has('fresh-run')).toBe(true);
  });

  it('keeps entries younger than 60 seconds', () => {
    vi.useFakeTimers();
    const now = Date.now();
    pendingStops.set('young-run', now); // just added

    evictStalePendingStops();

    expect(pendingStops.has('young-run')).toBe(true);
  });

  it('is a no-op when pendingStops is empty', () => {
    expect(() => evictStalePendingStops()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// D. Timeout watchdog
// ---------------------------------------------------------------------------

describe('timeout watchdog', () => {
  it('sends SIGTERM to process group after 30-minute timeout', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(5555);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-timeout' as any,
      commandName: 'long-runner',
      script: 'sleep 9999',
      workingDir: '/tmp',
    });

    // Advance just past the 30-minute (1 800 000 ms) watchdog
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    expect(killSpy).toHaveBeenCalledWith(-5555, 'SIGTERM');
  });

  it('force-kills with SIGKILL 5 seconds after SIGTERM if process has not exited', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(4444);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-forcekill' as any,
      commandName: 'unkillable',
      script: 'sleep 9999',
      workingDir: '/tmp',
    });

    // Trigger watchdog SIGTERM
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(killSpy).toHaveBeenCalledWith(-4444, 'SIGTERM');

    // Advance past the 5-second FORCE_KILL_DELAY_MS (process still in runningProcesses
    // because kill is mocked and no 'exit' event was emitted by the fake child)
    await vi.advanceTimersByTimeAsync(6_000);

    expect(killSpy).toHaveBeenCalledWith(-4444, 'SIGKILL');
  });

  it('does NOT fire watchdog SIGTERM after process exits normally', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(3333);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-exits-early' as any,
      commandName: 'short',
      script: 'echo done',
      workingDir: '/tmp',
    });

    // Simulate process exit (triggers the 'exit' handler which clears timers)
    (fakeChild as any)._emitter.emit('exit', 0, null);
    // Wait for microtasks (exit handler is async)
    await Promise.resolve();

    // Advance past watchdog threshold — timer should have been cleared on exit
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);

    // SIGTERM should NOT have been called (the timeoutTimer was cleared)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sigtermCalls = killSpy.mock.calls.filter((c: any) => c[1] === 'SIGTERM');
    expect(sigtermCalls).toHaveLength(0);
  });
});
