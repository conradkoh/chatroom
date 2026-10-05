/**
 * command-runner Unit Tests
 *
 * Tests the public API of command-runner.ts:
 *   - replace-on-rerun: prior running process killed when same command re-dispatched
 *   - pending-stop race: runOnCommandStop registers + runOnCommandRun consumes
 *   - evictStalePendingStops: TTL-based eviction of stale pending-stop entries
 *   - 24h soft timeout: process killed after 24-hour soft timeout
 *
 * Note: reapOrphansForDaemonRestart is a Convex mutation and is OUT OF SCOPE for unit
 * tests here — there is no convex-test infrastructure for backend mutations in
 * this CLI package. It is tested via convex-test integration tests in the backend package.
 */

import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

import type { FunctionReturnType } from 'convex/server';
import type { Runtime } from 'effect';
import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import {
  forceKillAllCommands,
  runOnCommandRun,
  runOnCommandStop,
} from './handlers/command-runner.js';
import type { CommandRunnerDeps } from './handlers/command-runner.js';
import type { api, Id } from '../../api.js';
import { processManager } from './handlers/process/manager.js';
import type { ConvexSubscriberDeps } from '../infrastructure/convex/subscriber-deps.js';
import {
  _resetCommandRunSubscriptionStateForTest,
  drainActionableCommandRuns,
} from './handlers/process/command-run-subscription.js';
import {
  deriveTerminalStatus,
  SIGTERM_GRACE_PERIOD_MS,
  SOFT_TIMEOUT_MS,
} from './handlers/process/state.js';
import { startCommandRunSubscriber } from '../infrastructure/convex/subscribers/command-run.js';

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
vi.mock('../../api.js', () => ({
  api: {
    commands: {
      updateRunStatus: 'mock-updateRunStatus',
      appendOutput: 'mock-appendOutput',
      updateRunTail: 'mock-updateRunTail',
      getRunStatus: 'mock-getRunStatus',
    },
    daemon: { commands: { listActionableCommandRuns: 'mock-listActionableCommandRuns' } },
  },
}));

// Mock the output-store module (needed by spawner.ts)
vi.mock('./handlers/process/output-store.js', () => ({
  createOutputStore: vi.fn(() => ({
    append: vi.fn().mockResolvedValue(undefined),
    getTail: vi.fn().mockReturnValue({ content: '', totalBytes: 0 }),
    getLastNLines: vi.fn().mockResolvedValue({ content: '', totalBytes: 0, lineCount: 0 }),
    getFullOutput: vi.fn().mockResolvedValue(''),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
  ensureTempDir: vi.fn().mockResolvedValue(undefined),
  cleanOrphanTempFiles: vi.fn().mockResolvedValue(undefined),
  TAIL_WINDOW_BYTES: 32 * 1024,
  MAX_TAIL_LINES_V2: 50,
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

/** Minimal CommandRunnerDeps with a mocked backend. */
function createRunnerDeps(): CommandRunnerDeps {
  return {
    sessionId: 'test-session',
    machineId: 'test-machine',
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
    },
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

let deps: CommandRunnerDeps;
// Captured in beforeEach so integration tests can selectively restore just this spy

let processKillSpy: { mockRestore: () => void };

beforeEach(() => {
  deps = createRunnerDeps();
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
  vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
  vi.mocked(deps.backend.query).mockResolvedValue(undefined);
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

    await runOnCommandRun(deps, {
      runId: 'run-force' as any,
      commandName: 'test',
      script: 'sleep 60',
      workingDir: '/tmp',
    });
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
    await runOnCommandRun(deps, {
      runId: 'run-first' as any,
      commandName: 'dev',
      script: 'pnpm dev',
      workingDir: '/tmp/project',
    });
    expect(processManager.has('run-first')).toBe(true);
    expect(processManager.getByCommand('test-machine|/tmp/project|dev')?.runId).toBe('run-first');

    // Second run — should kill first
    const secondRunPromise = runOnCommandRun(deps, {
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

    await runOnCommandRun(deps, {
      runId: 'run-dev' as any,
      commandName: 'dev',
      script: 'pnpm dev',
      workingDir: '/tmp/project',
    });

    await runOnCommandRun(deps, {
      runId: 'run-build' as any,
      commandName: 'build',
      script: 'pnpm build',
      workingDir: '/tmp/project',
    });

    // 'dev' process should NOT have been killed
    expect(process.kill).not.toHaveBeenCalledWith(-3333, expect.anything());
    expect(processManager.has('run-dev')).toBe(true);
    expect(processManager.has('run-build')).toBe(true);
  });

  it('spawn args include detached:true so the child leads its own process group', async () => {
    const fakeChild = createFakeChild(5555);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await runOnCommandRun(deps, {
      runId: 'run-spawn-opts' as any,
      commandName: 'test',
      script: 'echo hi',
      workingDir: '/tmp',
    });

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
    await runOnCommandStop(deps, { runId: 'run-orphan' as any });
    expect(processManager.hasPendingStop('run-orphan')).toBe(true);
  });

  it('skips spawning when a pending stop exists for the runId', async () => {
    // Simulate stop arriving before run
    await runOnCommandStop(deps, { runId: 'run-race' as any });
    expect(processManager.hasPendingStop('run-race')).toBe(true);

    // Now the run event arrives — should be skipped
    await runOnCommandRun(deps, {
      runId: 'run-race' as any,
      commandName: 'should-not-spawn',
      script: 'echo hi',
      workingDir: '/tmp',
    });

    // spawn must NOT have been called
    expect(spawn).not.toHaveBeenCalled();
    // Pending stop entry consumed
    expect(processManager.hasPendingStop('run-race')).toBe(false);
    // Backend should have been called with 'stopped' (both from runOnCommandStop AND runOnCommandRun skip)
    const mutationCalls = vi.mocked(deps.backend.mutation).mock.calls;
    const statusArgs = mutationCalls.map((c) => (c[1] as any)?.status);
    expect(statusArgs.filter((s) => s === 'stopped').length).toBeGreaterThanOrEqual(2);
  });

  it('proceeds with spawn when no pending stop exists for the runId', async () => {
    const fakeChild = createFakeChild(7777);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await runOnCommandRun(deps, {
      runId: 'run-normal' as any,
      commandName: 'normal',
      script: 'sleep 1',
      workingDir: '/tmp',
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(processManager.has('run-normal')).toBe(true);
  });

  it('throws when backend mutation fails so dispatchCommandEvent can retry', async () => {
    vi.mocked(deps.backend.mutation).mockRejectedValueOnce(new Error('Convex disconnect'));

    await expect(runOnCommandStop(deps, { runId: 'run-orphan-fail' as any })).rejects.toThrow(
      'Convex disconnect'
    );

    expect(processManager.hasPendingStop('run-orphan-fail')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// D. Pre-spawn DB status check (skip spawn when row already terminal)
// ---------------------------------------------------------------------------

describe('pre-spawn DB status check', () => {
  it('skips spawn when backend reports run is already stopped', async () => {
    // Mock getRunStatus to return 'stopped'
    vi.mocked(deps.backend.query).mockResolvedValue({ status: 'stopped' });

    await runOnCommandRun(deps, {
      runId: 'run-already-stopped' as any,
      commandName: 'dev',
      script: 'pnpm dev',
      workingDir: '/tmp',
    });

    // spawn must NOT have been called
    expect(spawn).not.toHaveBeenCalled();
    // No updateRunStatus write should occur
    expect(vi.mocked(deps.backend.mutation)).not.toHaveBeenCalled();
    // Not registered in process manager
    expect(processManager.has('run-already-stopped')).toBe(false);
  });

  it('skips spawn when run is killed, completed, or failed', async () => {
    for (const status of ['killed', 'completed', 'failed']) {
      vi.mocked(deps.backend.query).mockResolvedValue({ status });

      await runOnCommandRun(deps, {
        runId: `run-${status}` as any,
        commandName: 'test',
        script: 'echo hi',
        workingDir: '/tmp',
      });

      expect(spawn).not.toHaveBeenCalled();
      // Reset for next iteration
      vi.mocked(spawn).mockClear();
    }
  });

  it('proceeds with spawn when backend reports pending', async () => {
    vi.mocked(deps.backend.query).mockResolvedValue({ status: 'pending' });
    const fakeChild = createFakeChild(6666);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await runOnCommandRun(deps, {
      runId: 'run-pending-ok' as any,
      commandName: 'dev',
      script: 'pnpm dev',
      workingDir: '/tmp',
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(processManager.has('run-pending-ok')).toBe(true);
  });

  it('proceeds with spawn when run is running (replace case)', async () => {
    vi.mocked(deps.backend.query).mockResolvedValue({ status: 'running' });
    const fakeChild = createFakeChild(7777);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);

    await runOnCommandRun(deps, {
      runId: 'run-running-replace' as any,
      commandName: 'dev',
      script: 'pnpm dev',
      workingDir: '/tmp',
    });

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(processManager.has('run-running-replace')).toBe(true);
  });

  it('proceeds with spawn when backend query fails (recoverable error)', async () => {
    const fakeChild = createFakeChild(8888);
    vi.mocked(spawn).mockReturnValueOnce(fakeChild as any);
    // Backend query throws
    vi.mocked(deps.backend.query).mockRejectedValueOnce(new Error('Convex disconnect'));

    await runOnCommandRun(deps, {
      runId: 'run-query-fail' as any,
      commandName: 'dev',
      script: 'pnpm dev',
      workingDir: '/tmp',
    });

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
    await runOnCommandRun(deps, {
      runId: runId as any,
      commandName: 'long-runner',
      script: 'sleep 9999',
      workingDir: '/tmp',
    });

    stopOutputFlushTimer(runId);
    await vi.advanceTimersByTimeAsync(SOFT_TIMEOUT_MS + 1_000);
    await flushAsyncWork();

    const mutationCalls = vi.mocked(deps.backend.mutation).mock.calls;
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
    await runOnCommandRun(deps, {
      runId: runId as any,
      commandName: 'unkillable',
      script: 'sleep 9999',
      workingDir: '/tmp',
    });

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
    await runOnCommandRun(deps, {
      runId: runId as any,
      commandName: 'short',
      script: 'echo done',
      workingDir: '/tmp',
    });

    // Simulate process exit (triggers the 'exit' handler which clears timers)
    (fakeChild as any)._emitter.emit('exit', 0, null);
    await flushAsyncWork();

    // Clear any mutation calls from the exit handler
    vi.mocked(deps.backend.mutation).mockClear();

    stopOutputFlushTimer(runId);
    // Advance past soft timeout threshold — timer should have been cleared on exit
    await vi.advanceTimersByTimeAsync(SOFT_TIMEOUT_MS + 60 * 60 * 1000);

    // No 'killed' call should have happened
    const killedCalls = vi
      .mocked(deps.backend.mutation)
      .mock.calls.filter((c) => (c[1] as any)?.status === 'killed');
    expect(killedCalls).toHaveLength(0);
    expect(process.kill).not.toHaveBeenCalledWith(-3333, expect.anything());
  });
});

// ---------------------------------------------------------------------------
// G. Real-process-tree regression test (integration)
//
// Routes a pending and later stop update through the subscriber, actionable-run
// drain, and real command effects. Verifies process-group termination end to end.
// ---------------------------------------------------------------------------

type ActionableCommandRuns = FunctionReturnType<
  typeof api.daemon.commands.listActionableCommandRuns
>;
type WatchCallback = (result: ActionableCommandRuns | null | undefined) => void;

function makeCommandRunRuntime(
  session: DaemonSessionServiceShape
): Runtime.Runtime<DaemonSessionService> {
  return Effect.runSync(
    Effect.runtime<DaemonSessionService>().pipe(
      Effect.provideService(DaemonSessionService, session)
    )
  );
}

describe('process-group kill (real process tree)', () => {
  it('stops the same run through subscriber updates and kills all descendants', async () => {
    if (process.platform === 'win32') return;

    processKillSpy.mockRestore();
    const actual = (await vi.importActual('node:child_process')) as {
      spawn: typeof spawn;
      execSync: (command: string) => Buffer;
    };
    const { spawn: realSpawn, execSync } = actual;
    vi.mocked(spawn).mockImplementation(realSpawn as typeof spawn);

    const runId = 'run-real-tree' as Id<'chatroom_commandRunsV2'>;
    const row = {
      _id: runId,
      workingDir: '/tmp',
      commandName: 'test',
      script: 'sleep 30 & sleep 30 & sleep 30 & wait',
    } as ActionableCommandRuns['pendingRuns'][number];
    let actionable: ActionableCommandRuns = { pendingRuns: [row], stopRequestedRuns: [] };
    let update!: WatchCallback;
    const unsubscribe = vi.fn();
    const wsClient = {
      onUpdate: vi.fn((_query, _args, callback: WatchCallback) => {
        update = callback;
        return unsubscribe;
      }),
    } as unknown as ConvexSubscriberDeps['wsClient'];
    const mutation = vi.fn(async (_reference: unknown, _args: { status?: string }) => undefined);
    const query = vi.fn(async (reference: unknown) =>
      reference === 'mock-listActionableCommandRuns' ? actionable : { status: 'pending' }
    );
    const session = {
      sessionId: 'test-session',
      machineId: 'test-machine',
      convexUrl: 'http://test-convex-url',
      client: {},
      config: null,
      backend: { query, mutation },
      fs: {},
      agentServices: new Map(),
      events: {},
      lastPushedGitState: new Map(),
      lastPushedModels: null,
      lastPushedHarnessFingerprint: null,
      logEvent: async () => undefined,
      taskService: {},
      agentConfigRegistry: { get: () => undefined },
    } as unknown as DaemonSessionServiceShape;
    const runtime = makeCommandRunRuntime(session);
    const subscriber = startCommandRunSubscriber(
      {
        wsClient,
        sessionId: session.sessionId as ConvexSubscriberDeps['sessionId'],
        machineId: session.machineId,
      },
      (event) => {
        if (event.type === 'command-run.updated') void drainActionableCommandRuns(session, runtime);
      }
    );

    let pid: number | undefined;
    let children: number[] = [];
    try {
      update(actionable);
      await vi.waitFor(() => {
        expect(processManager.get(String(runId))).toBeDefined();
        expect(mutation).toHaveBeenCalledWith(
          'mock-updateRunStatus',
          expect.objectContaining({ runId, status: 'running' })
        );
      });

      const tracked = processManager.get(String(runId));
      expect(tracked).toBeDefined();
      pid = tracked?.process.pid;
      if (pid === undefined) throw new Error('expected tracked process to have a pid');
      const leaderPid = pid;
      expect(() => process.kill(leaderPid, 0)).not.toThrow();

      const childrenOutput = execSync(`pgrep -P ${pid}`).toString().trim();
      children = childrenOutput.split('\n').map(Number).filter(Boolean);
      expect(children.length).toBeGreaterThanOrEqual(3);
      for (const childPid of children) expect(() => process.kill(childPid, 0)).not.toThrow();

      actionable = { pendingRuns: [], stopRequestedRuns: [] };
      update(actionable);
      actionable = { pendingRuns: [], stopRequestedRuns: [row] };
      update(actionable);

      await vi.waitFor(
        () => {
          expect(mutation).toHaveBeenCalledWith(
            'mock-updateRunStatus',
            expect.objectContaining({ runId, status: 'stopped' })
          );
        },
        { timeout: 15_000 }
      );
      await vi.waitFor(
        () => {
          expect(processManager.get(String(runId))).toBeUndefined();
        },
        { timeout: 15_000 }
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 300));

      for (const childPid of children) expect(() => process.kill(childPid, 0)).toThrow();
      expect(() => process.kill(leaderPid, 0)).toThrow();
      expect(processManager.has(String(runId))).toBe(false);
    } finally {
      await subscriber.stop();
      _resetCommandRunSubscriptionStateForTest();
      const tracked = processManager.get(String(runId));
      if (tracked) {
        clearInterval(tracked.flushTimer);
        if (tracked.softTimeoutTimer) clearTimeout(tracked.softTimeoutTimer);
      }
      const cleanupPid = pid ?? tracked?.process.pid;
      if (cleanupPid !== undefined) {
        try {
          process.kill(-cleanupPid, 'SIGKILL');
        } catch {
          // Process group already exited.
        }
      }
      processManager.clear();
    }
  }, 40_000);
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
