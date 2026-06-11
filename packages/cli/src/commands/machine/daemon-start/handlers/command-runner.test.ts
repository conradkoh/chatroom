/**
 * command-runner Unit Tests
 *
 * Tests the public API of command-runner.ts:
 *   - replace-on-rerun: prior running process killed when same command re-dispatched
 *   - pending-stop race: onCommandStopCore registers + onCommandRunCore consumes
 *   - evictStalePendingStops: TTL-based eviction of stale pending-stop entries
 *   - 24h soft timeout: process killed after 24-hour soft timeout
 *
 * Note: reapOrphansForDaemonRestart is a Convex mutation and is OUT OF SCOPE for unit
 * tests here — there is no convex-test infrastructure for backend mutations in
 * this CLI package. It is tested via convex-test integration tests in the backend package.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { forceKillAllCommands, onCommandRunCore, onCommandStopCore } from './command-runner.js';
import type { DaemonContext } from '../types.js';
import { processManager } from './process/manager.js';
import { deriveTerminalStatus, SIGTERM_GRACE_PERIOD_MS, SOFT_TIMEOUT_MS } from './process/state.js';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any imports that use them
// ---------------------------------------------------------------------------

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  access: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// Mock the convex api — mutation/query refs are just opaque tokens for the mock
vi.mock('../../../../api.js', () => ({
  api: {
    commands: {
      updateRunStatus: 'mock-updateRunStatus',
      appendOutput: 'mock-appendOutput',
      updateRunTailV2: 'mock-updateRunTailV2',
      getRunStatus: 'mock-getRunStatus',
    },
  },
}));

// Mock the output-store module (needed by spawner.ts)
vi.mock('./process/output-store.js', () => ({
  createOutputStore: vi.fn(() => ({
    append: vi.fn().mockResolvedValue(undefined),
    getTail: vi.fn().mockReturnValue({ content: '', totalBytes: 0 }),
    getFullOutput: vi.fn().mockResolvedValue(''),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
  ensureTempDir: vi.fn().mockResolvedValue(undefined),
  cleanOrphanTempFiles: vi.fn().mockResolvedValue(undefined),
  TAIL_WINDOW_BYTES: 32 * 1024,
}));

// Mock output-encoding (needed by spawner.ts)
vi.mock('@workspace/backend/src/output-encoding.js', () => ({
  encodeOutput: vi.fn((plain: string) => ({
    compression: 'gzip',
    content: `gzip:${plain}`,
  })),
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

/** Clears the 3s output flush interval so advancing 24h does not run thousands of callbacks. */
function stopOutputFlushTimer(runId: string): void {
  const tracked = processManager.get(runId);
  if (tracked) {
    clearInterval(tracked.flushTimer);
  }
}

/** Flush microtasks after an async fake-timer callback (e.g. soft-timeout handler). */
async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let ctx: DaemonContext;
// Captured in beforeEach so integration tests can selectively restore just this spy

let processKillSpy: { mockRestore: () => void };

beforeEach(() => {
  ctx = createCtx();
  // Clear module-level state between tests
  processManager.clear();
  // Reset all mock call counts and implementations
  vi.clearAllMocks();
  // Default spawn implementation — returns a new fake child per call
  vi.mocked(spawn).mockImplementation((): any =>
    createFakeChild(Math.floor(Math.random() * 90000) + 10000)
  );
  // Mock process.kill so negative-PID group kills don't target real processes
  processKillSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);
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
  processManager.clear();
});

// ---------------------------------------------------------------------------
// A2. forceKillAllCommands — synchronous force-exit path (second Ctrl+C)
// ---------------------------------------------------------------------------

describe('forceKillAllCommands', () => {
  it('is a no-op when no processes are running', () => {
    expect(() => forceKillAllCommands()).not.toThrow();
    expect(process.kill).not.toHaveBeenCalled();
  });

  it('synchronously SIGKILLs every tracked process group without awaiting', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(5151);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-force' as any,
        commandName: 'test',
        script: 'sleep 60',
        workingDir: '/tmp',
      }
    );
    expect(processManager.size).toBe(1);

    forceKillAllCommands();

    // Immediate SIGKILL to the process group — no SIGTERM, no grace period.
    expect(process.kill).toHaveBeenCalledWith(-5151, 'SIGKILL');
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
    vi.mocked(spawn)
      .mockReturnValueOnce(firstChild as any)
      .mockReturnValueOnce(secondChild as any);

    // First run
    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-first' as any,
        commandName: 'dev',
        script: 'pnpm dev',
        workingDir: '/tmp/project',
      }
    );
    expect(processManager.has('run-first')).toBe(true);
    expect(processManager.getByCommand('test-machine|/tmp/project|dev')?.runId).toBe('run-first');

    // Second run — should kill first
    const secondRunPromise = onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-second' as any,
        commandName: 'dev',
        script: 'pnpm dev',
        workingDir: '/tmp/project',
      }
    );

    // Advance past SIGTERM grace period
    await vi.advanceTimersByTimeAsync(6_000);
    // Simulate first process exiting after kill
    firstChild._emitter.emit('exit', null, 'SIGTERM');
    await Promise.resolve();
    await secondRunPromise;

    expect(process.kill).toHaveBeenCalledWith(-1111, 'SIGTERM');
    expect(processManager.has('run-second')).toBe(true);
    expect(processManager.getByCommand('test-machine|/tmp/project|dev')?.runId).toBe('run-second');
  });

  it('does NOT kill prior run if commandName differs', async () => {
    vi.useFakeTimers();
    const devChild = createFakeChild(3333);
    const buildChild = createFakeChild(4444);
    vi.mocked(spawn)
      .mockReturnValueOnce(devChild as any)
      .mockReturnValueOnce(buildChild as any);

    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-dev' as any,
        commandName: 'dev',
        script: 'pnpm dev',
        workingDir: '/tmp/project',
      }
    );

    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-build' as any,
        commandName: 'build',
        script: 'pnpm build',
        workingDir: '/tmp/project',
      }
    );

    // 'dev' process should NOT have been killed
    expect(process.kill).not.toHaveBeenCalledWith(-3333, expect.anything());
    expect(processManager.has('run-dev')).toBe(true);
    expect(processManager.has('run-build')).toBe(true);
  });

  it('spawn args include detached:true so the child leads its own process group', async () => {
    const fakeChild = createFakeChild(5555);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-spawn-opts' as any,
        commandName: 'test',
        script: 'echo hi',
        workingDir: '/tmp',
      }
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    const spawnOpts = vi.mocked(spawn).mock.calls[0][2] as any;
    expect(spawnOpts.detached).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C. Pending-stop race
// ---------------------------------------------------------------------------

describe('pending-stop race (stop-before-run)', () => {
  it('registers a pending stop when no process is found for the runId', async () => {
    await onCommandStopCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      { runId: 'run-orphan' as any }
    );
    expect(processManager.hasPendingStop('run-orphan')).toBe(true);
  });

  it('skips spawning when a pending stop exists for the runId', async () => {
    // Simulate stop arriving before run
    await onCommandStopCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      { runId: 'run-race' as any }
    );
    expect(processManager.hasPendingStop('run-race')).toBe(true);

    // Now the run event arrives — should be skipped
    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-race' as any,
        commandName: 'should-not-spawn',
        script: 'echo hi',
        workingDir: '/tmp',
      }
    );

    // spawn must NOT have been called
    expect(spawn).not.toHaveBeenCalled();
    // Pending stop entry consumed
    expect(processManager.hasPendingStop('run-race')).toBe(false);
    // Backend should have been called with 'stopped' (both from onCommandStopCore AND onCommandRunCore skip)
    const mutationCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls;
    const statusArgs = mutationCalls.map((c) => (c[1] as any)?.status);
    expect(statusArgs.filter((s) => s === 'stopped').length).toBeGreaterThanOrEqual(2);
  });

  it('proceeds with spawn when no pending stop exists for the runId', async () => {
    const fakeChild = createFakeChild(7777);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-normal' as any,
        commandName: 'normal',
        script: 'sleep 1',
        workingDir: '/tmp',
      }
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(processManager.has('run-normal')).toBe(true);
  });

  it('throws when backend mutation fails so dispatchCommandEvent can retry', async () => {
    vi.mocked(ctx.deps.backend.mutation).mockRejectedValueOnce(new Error('Convex disconnect'));

    await expect(
      onCommandStopCore(
        { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
        { runId: 'run-orphan-fail' as any }
      )
    ).rejects.toThrow('Convex disconnect');

    expect(processManager.hasPendingStop('run-orphan-fail')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. Pre-spawn DB status check (skip spawn when row already terminal)
// ---------------------------------------------------------------------------

describe('pre-spawn DB status check', () => {
  it('skips spawn when backend reports run is already stopped', async () => {
    // Mock getRunStatus to return 'stopped'
    vi.mocked(ctx.deps.backend.query).mockResolvedValue({ status: 'stopped' });

    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-already-stopped' as any,
        commandName: 'dev',
        script: 'pnpm dev',
        workingDir: '/tmp',
      }
    );

    // spawn must NOT have been called
    expect(spawn).not.toHaveBeenCalled();
    // No updateRunStatus write should occur
    expect(vi.mocked(ctx.deps.backend.mutation)).not.toHaveBeenCalled();
    // Not registered in process manager
    expect(processManager.has('run-already-stopped')).toBe(false);
  });

  it('skips spawn when run is killed, completed, or failed', async () => {
    for (const status of ['killed', 'completed', 'failed']) {
      vi.mocked(ctx.deps.backend.query).mockResolvedValue({ status });

      await onCommandRunCore(
        { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
        {
          runId: `run-${status}` as any,
          commandName: 'test',
          script: 'echo hi',
          workingDir: '/tmp',
        }
      );

      expect(spawn).not.toHaveBeenCalled();
      // Reset for next iteration
      vi.mocked(spawn).mockClear();
    }
  });

  it('proceeds with spawn when backend reports pending', async () => {
    vi.mocked(ctx.deps.backend.query).mockResolvedValue({ status: 'pending' });
    const fakeChild = createFakeChild(6666);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-pending-ok' as any,
        commandName: 'dev',
        script: 'pnpm dev',
        workingDir: '/tmp',
      }
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(processManager.has('run-pending-ok')).toBe(true);
  });

  it('proceeds with spawn when run is running (replace case)', async () => {
    vi.mocked(ctx.deps.backend.query).mockResolvedValue({ status: 'running' });
    const fakeChild = createFakeChild(7777);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-running-replace' as any,
        commandName: 'dev',
        script: 'pnpm dev',
        workingDir: '/tmp',
      }
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(processManager.has('run-running-replace')).toBe(true);
  });

  it('proceeds with spawn when backend query fails (recoverable error)', async () => {
    const fakeChild = createFakeChild(8888);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);
    // Backend query throws
    vi.mocked(ctx.deps.backend.query).mockRejectedValueOnce(new Error('Convex disconnect'));

    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: 'run-query-fail' as any,
        commandName: 'dev',
        script: 'pnpm dev',
        workingDir: '/tmp',
      }
    );

    // Should still spawn (error is non-fatal)
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(processManager.has('run-query-fail')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E. evictStalePendingStops
// ---------------------------------------------------------------------------

describe('evictStalePendingStops', () => {
  it('evicts entries older than 60 seconds', () => {
    vi.useFakeTimers();
    processManager.markPendingStop('old-run');
    vi.advanceTimersByTime(61_000);
    processManager.markPendingStop('fresh-run');

    processManager.evictStalePendingStops();

    expect(processManager.hasPendingStop('old-run')).toBe(false);
    expect(processManager.hasPendingStop('fresh-run')).toBe(true);
  });

  it('keeps entries younger than 60 seconds', () => {
    vi.useFakeTimers();
    processManager.markPendingStop('young-run');

    processManager.evictStalePendingStops();

    expect(processManager.hasPendingStop('young-run')).toBe(true);
  });

  it('is a no-op when pendingStops is empty', () => {
    expect(() => processManager.evictStalePendingStops()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// F. 24-hour soft timeout
// ---------------------------------------------------------------------------

describe('24-hour soft timeout', () => {
  it('calls updateRunStatus with killed + timeout-24h after 24h', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(5555);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    const runId = 'run-timeout-24h';
    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: runId as any,
        commandName: 'long-runner',
        script: 'sleep 9999',
        workingDir: '/tmp',
      }
    );

    stopOutputFlushTimer(runId);
    await vi.advanceTimersByTimeAsync(SOFT_TIMEOUT_MS + 1_000);
    await flushAsyncWork();

    const mutationCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls;
    const killedCall = mutationCalls.find((c) => (c[1] as any)?.status === 'killed');
    expect(killedCall).toBeDefined();
    expect((killedCall?.[1] as any).terminationReason).toBe('timeout-24h');

    // SIGTERM sent to the entire process group (negative PID)
    expect(process.kill).toHaveBeenCalledWith(-5555, 'SIGTERM');
  });

  it('force-kills with SIGKILL 5s after SIGTERM if process has not exited', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(4444);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    const runId = 'run-forcekill-24h';
    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: runId as any,
        commandName: 'unkillable',
        script: 'sleep 9999',
        workingDir: '/tmp',
      }
    );

    stopOutputFlushTimer(runId);
    await vi.advanceTimersByTimeAsync(SOFT_TIMEOUT_MS + 1_000);
    await flushAsyncWork();
    expect(process.kill).toHaveBeenCalledWith(-4444, 'SIGTERM');

    // Advance past the SIGTERM grace period (process still in processManager
    // because no 'exit' event was emitted by the fake child)
    await vi.advanceTimersByTimeAsync(SIGTERM_GRACE_PERIOD_MS + 1_000);

    expect(process.kill).toHaveBeenCalledWith(-4444, 'SIGKILL');
  });

  it('does NOT fire soft timeout after process exits normally', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild(3333);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    const runId = 'run-exits-early';
    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId: runId as any,
        commandName: 'short',
        script: 'echo done',
        workingDir: '/tmp',
      }
    );

    // Simulate process exit (triggers the 'exit' handler which clears timers)
    (fakeChild as any)._emitter.emit('exit', 0, null);
    await flushAsyncWork();

    // Clear any mutation calls from the exit handler
    vi.mocked(ctx.deps.backend.mutation).mockClear();

    stopOutputFlushTimer(runId);
    // Advance past soft timeout threshold — timer should have been cleared on exit
    await vi.advanceTimersByTimeAsync(SOFT_TIMEOUT_MS + 60 * 60 * 1000);

    // No 'killed' call should have happened
    const killedCalls = vi
      .mocked(ctx.deps.backend.mutation)
      .mock.calls.filter((c) => (c[1] as any)?.status === 'killed');
    expect(killedCalls).toHaveLength(0);
    expect(process.kill).not.toHaveBeenCalledWith(-3333, expect.anything());
  });
});

// ---------------------------------------------------------------------------
// G. Real-process-tree regression test (integration)
//
// Routes through onCommandRunCore → onCommandStopCore with a real spawned process tree.
// Verifies that the process-group kill (detached:true + negative PID) terminates
// not just the sh leader but ALL grandchildren (the bug this fix addresses).
// ---------------------------------------------------------------------------

describe('process-group kill (real process tree)', () => {
  it('kills all grandchildren when onCommandStopCore is called — not just the sh leader', async () => {
    if (process.platform === 'win32') {
      // process groups behave differently on Windows — skip
      return;
    }

    // Restore only the process.kill spy (not all mocks) so group kills hit the real OS.
    // Scoped restore avoids clobbering console spies or the spawn module mock.
    processKillSpy.mockRestore();

    // Wire the module-level spawn mock to delegate to the real child_process.spawn.
    // This means onCommandRunCore's internal spawn() call uses a real process.
    const actual = (await vi.importActual('node:child_process')) as {
      spawn: typeof spawn;
      execSync: (command: string) => Buffer;
    };
    const { spawn: realSpawn, execSync } = actual;
    vi.mocked(spawn).mockImplementation(realSpawn as any);

    // Run the command through the real handler (exercises the detached:true spawn path)
    const runId = 'run-real-tree' as any;
    await onCommandRunCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      {
        runId,
        commandName: 'test',
        script: 'sleep 30 & sleep 30 & sleep 30 & wait',
        workingDir: '/tmp',
      }
    );

    // Wait for sh + its three sleep children to start
    await new Promise<void>((r) => setTimeout(r, 400));

    // Get the tracked process PID
    const tracked = processManager.get(String(runId));
    expect(tracked).toBeDefined();
    const pid = tracked?.process.pid;
    if (pid === undefined) throw new Error('expected tracked process to have a pid');

    // Verify sh leader is alive
    expect(() => process.kill(pid, 0)).not.toThrow();

    // Capture grandchild PIDs (the sleep processes) before we kill
    const childrenOutput = execSync(`pgrep -P ${pid}`).toString().trim();
    const children = childrenOutput.split('\n').map(Number).filter(Boolean);
    // There should be at least the three sleep 30 processes
    expect(children.length).toBeGreaterThanOrEqual(3);

    // Verify each grandchild is alive before stop
    for (const childPid of children) {
      expect(() => process.kill(childPid, 0)).not.toThrow();
    }

    // Stop via the actual handler — exercises killProcess() → process.kill(-pid, signal)
    await onCommandStopCore(
      { sessionId: ctx.sessionId, machineId: ctx.machineId, backend: ctx.deps.backend },
      { runId }
    );

    // Brief additional wait for all OS-level cleanup
    await new Promise<void>((r) => setTimeout(r, 300));

    // All grandchildren must be gone — this is exactly the bug the fix prevents:
    // without process-group kill, these sleep processes would survive as orphans.
    for (const childPid of children) {
      expect(() => process.kill(childPid, 0)).toThrow();
    }
  }, 15_000);
});

// ---------------------------------------------------------------------------
// H. deriveTerminalStatus — pure function
// ---------------------------------------------------------------------------

describe('deriveTerminalStatus', () => {
  // No intent — infer from exit code/signal

  it('no intent + code=0 → completed', () => {
    expect(deriveTerminalStatus(0, null, null)).toBe('completed');
  });

  it('no intent + code=1 (non-zero) + no signal → failed', () => {
    expect(deriveTerminalStatus(1, null, null)).toBe('failed');
  });

  it('no intent + SIGTERM signal → stopped (external termination)', () => {
    expect(deriveTerminalStatus(null, 'SIGTERM', null)).toBe('stopped');
  });

  it('no intent + SIGKILL signal → stopped', () => {
    expect(deriveTerminalStatus(null, 'SIGKILL', null)).toBe('stopped');
  });

  // Intent overrides signal

  it('intent=killed + SIGTERM → killed (replace/timeout overrides signal)', () => {
    expect(deriveTerminalStatus(null, 'SIGTERM', 'killed')).toBe('killed');
  });

  it('intent=killed + SIGKILL → killed (intent overrides SIGKILL)', () => {
    expect(deriveTerminalStatus(null, 'SIGKILL', 'killed')).toBe('killed');
  });

  it('intent=stopped + SIGTERM → stopped (user-stop intent matches, no ambiguity)', () => {
    expect(deriveTerminalStatus(null, 'SIGTERM', 'stopped')).toBe('stopped');
  });

  it('intent=stopped + non-zero exit code → stopped (intent overrides exit code)', () => {
    expect(deriveTerminalStatus(1, null, 'stopped')).toBe('stopped');
  });

  // Edge case: intent overrides even a clean exit (daemon killed process just as it exited 0)
  it('intent=killed + code=0 → killed (intent takes priority over clean exit)', () => {
    expect(deriveTerminalStatus(0, null, 'killed')).toBe('killed');
  });
});
