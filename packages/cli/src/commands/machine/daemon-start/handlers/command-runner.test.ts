/**
 * command-runner Unit Tests
 *
 * Tests the public API of command-runner.ts:
 *   - shutdownAllCommands: kills tracked processes and marks runs as killed
 *   - replace-on-rerun: prior running process killed when same command re-dispatched
 *   - pending-stop race: onCommandStop registers + onCommandRun consumes
 *   - evictStalePendingStops: TTL-based eviction of stale pending-stop entries
 *   - 24h soft timeout: process killed after 24-hour soft timeout
 *
 * Note: clearStaleCommandRuns is a Convex mutation and is OUT OF SCOPE for unit
 * tests here — there is no convex-test infrastructure for backend mutations in
 * this repo. It is tested manually / via integration tests against a real deployment.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------


import {
  onCommandRun,
  onCommandStop,
  shutdownAllCommands,
  evictStalePendingStops,
  runningProcesses, // @internal
  runningProcessesByCommand, // @internal
  pendingStops,     // @internal
} from './command-runner.js';
import type { DaemonContext } from '../types.js';

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
        listAgentEntries: vi.fn().mockResolvedValue([]),
        persistEventCursor: vi.fn(),
        loadEventCursor: vi.fn().mockResolvedValue(null),
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
function createFakeChild(pid = 9999) {
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

beforeEach(() => {
  ctx = createCtx();
  // Clear module-level state between tests
  runningProcesses.clear();
  runningProcessesByCommand.clear();
  pendingStops.clear();
  // Reset all mock call counts and implementations
  vi.clearAllMocks();
  // Default spawn implementation — returns a new fake child per call
  vi.mocked(spawn).mockImplementation((): any =>
    createFakeChild(Math.floor(Math.random() * 90000) + 10000)
  );
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
  runningProcessesByCommand.clear();
  pendingStops.clear();
});

// ---------------------------------------------------------------------------
// A. shutdownAllCommands
// ---------------------------------------------------------------------------

describe('shutdownAllCommands', () => {
  it('is a no-op when no processes are running', async () => {
    await shutdownAllCommands(ctx);
    expect(vi.mocked(ctx.deps.backend.mutation)).not.toHaveBeenCalled();
  });

  it('sends SIGTERM to each running process and clears runningProcesses', async () => {
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

    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(runningProcesses.size).toBe(0);
  });

  it("marks each run as status='killed' with terminationReason='daemon-shutdown'", async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(9998);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-shutdown-mark' as any,
      commandName: 'test',
      script: 'sleep 60',
      workingDir: '/tmp',
    });

    const shutdownPromise = shutdownAllCommands(ctx);
    await vi.advanceTimersByTimeAsync(4_000);
    await shutdownPromise;

    const mutationCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls;
    const killedCall = mutationCalls.find(
      (c) => (c[1] as any)?.status === 'killed'
    );
    expect(killedCall).toBeDefined();
    expect((killedCall![1] as any).terminationReason).toBe('daemon-shutdown');
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

    // SIGTERM was sent first, SIGKILL after grace period
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');
    expect(runningProcesses.size).toBe(0);
  });

  it('does NOT use detached:true — no negative-PID kill calls', async () => {
    vi.useFakeTimers();
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
    const fakeChild = createFakeChild(7777);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-no-detach' as any,
      commandName: 'test',
      script: 'sleep 60',
      workingDir: '/tmp',
    });

    const shutdownPromise = shutdownAllCommands(ctx);
    await vi.advanceTimersByTimeAsync(4_000);
    await shutdownPromise;

    // process.kill should NOT be called with a negative PID (that's process group kill)
    const negPidCalls = killSpy.mock.calls.filter((c: any) => typeof c[0] === 'number' && c[0] < 0);
    expect(negPidCalls).toHaveLength(0);
    // child.kill should have been called instead
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
  });
});

// ---------------------------------------------------------------------------
// B. Replace-on-rerun
// ---------------------------------------------------------------------------

describe('replace-on-rerun', () => {
  it('kills prior tracked process when same (machineId, workingDir, commandName) re-dispatched', async () => {
    vi.useFakeTimers();
    const firstChild = createFakeChild(1111);
    const secondChild = createFakeChild(2222);
    vi.mocked(spawn).mockReturnValueOnce(firstChild as any).mockReturnValueOnce(secondChild as any);

    // First run
    await onCommandRun(ctx, {
      runId: 'run-first' as any,
      commandName: 'dev',
      script: 'pnpm dev',
      workingDir: '/tmp/project',
    });
    expect(runningProcesses.has('run-first')).toBe(true);
    expect(runningProcessesByCommand.get('test-machine|/tmp/project|dev')).toBe('run-first');

    // Second run — should kill first
    const secondRunPromise = onCommandRun(ctx, {
      runId: 'run-second' as any,
      commandName: 'dev',
      script: 'pnpm dev',
      workingDir: '/tmp/project',
    });

    // Advance past SIGTERM grace period
    await vi.advanceTimersByTimeAsync(6_000);
    // Simulate first process exiting after kill
    firstChild._emitter.emit('exit', null, 'SIGTERM');
    await Promise.resolve();
    await secondRunPromise;

    expect(firstChild.kill).toHaveBeenCalledWith('SIGTERM');
    expect(runningProcesses.has('run-second')).toBe(true);
    expect(runningProcessesByCommand.get('test-machine|/tmp/project|dev')).toBe('run-second');
  });

  it('does NOT kill prior run if commandName differs', async () => {
    vi.useFakeTimers();
    const devChild = createFakeChild(3333);
    const buildChild = createFakeChild(4444);
    vi.mocked(spawn).mockReturnValueOnce(devChild as any).mockReturnValueOnce(buildChild as any);

    await onCommandRun(ctx, {
      runId: 'run-dev' as any,
      commandName: 'dev',
      script: 'pnpm dev',
      workingDir: '/tmp/project',
    });

    await onCommandRun(ctx, {
      runId: 'run-build' as any,
      commandName: 'build',
      script: 'pnpm build',
      workingDir: '/tmp/project',
    });

    // 'dev' process should NOT have been killed
    expect(devChild.kill).not.toHaveBeenCalled();
    expect(runningProcesses.has('run-dev')).toBe(true);
    expect(runningProcesses.has('run-build')).toBe(true);
  });

  it('spawn args do NOT include detached:true', async () => {
    const fakeChild = createFakeChild(5555);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-spawn-opts' as any,
      commandName: 'test',
      script: 'echo hi',
      workingDir: '/tmp',
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    const spawnOpts = vi.mocked(spawn).mock.calls[0][2] as any;
    expect(spawnOpts.detached).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// C. Pending-stop race
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
    vi.mocked(ctx.deps.backend.mutation).mockRejectedValueOnce(new Error('Convex disconnect'));

    await expect(onCommandStop(ctx, { runId: 'run-orphan-fail' as any })).rejects.toThrow(
      'Convex disconnect'
    );

    expect(pendingStops.has('run-orphan-fail')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. evictStalePendingStops
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
// E. 24-hour soft timeout
// ---------------------------------------------------------------------------

describe('24-hour soft timeout', () => {
  it('calls updateRunStatus with killed + timeout-24h after 24h', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(5555);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-timeout-24h' as any,
      commandName: 'long-runner',
      script: 'sleep 9999',
      workingDir: '/tmp',
    });

    // Advance past the 24-hour soft timeout
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1_000);

    const mutationCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls;
    const killedCall = mutationCalls.find(
      (c) => (c[1] as any)?.status === 'killed'
    );
    expect(killedCall).toBeDefined();
    expect((killedCall![1] as any).terminationReason).toBe('timeout-24h');

    // SIGTERM sent to child
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');
  });

  it('force-kills with SIGKILL 5s after SIGTERM if process has not exited', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(4444);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRun(ctx, {
      runId: 'run-forcekill-24h' as any,
      commandName: 'unkillable',
      script: 'sleep 9999',
      workingDir: '/tmp',
    });

    // Trigger 24h soft timeout
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000 + 1_000);
    expect(fakeChild.kill).toHaveBeenCalledWith('SIGTERM');

    // Advance past the 5-second SIGTERM grace period (process still in runningProcesses
    // because no 'exit' event was emitted by the fake child)
    await vi.advanceTimersByTimeAsync(6_000);

    expect(fakeChild.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('does NOT fire soft timeout after process exits normally', async () => {
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

    // Clear any mutation calls from the exit handler
    vi.mocked(ctx.deps.backend.mutation).mockClear();

    // Advance past soft timeout threshold — timer should have been cleared on exit
    await vi.advanceTimersByTimeAsync(25 * 60 * 60 * 1000);

    // No 'killed' call should have happened
    const killedCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls.filter(
      (c) => (c[1] as any)?.status === 'killed'
    );
    expect(killedCalls).toHaveLength(0);
    expect(fakeChild.kill).not.toHaveBeenCalled();
  });
});
