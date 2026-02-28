/**
 * onAgentShutdown TDD Tests
 *
 * Tests for onAgentShutdown using dependency injection.
 *
 * Key behaviors tested:
 * - stops.mark called before kill
 * - PID cleared ONLY after confirming process is dead
 * - All exceptions from external calls are caught and handled gracefully
 *
 * Note: Backend cleanup (updateSpawnedAgent, participants.leave) is no longer
 * done in onAgentShutdown — it is handled by the agent:exited event listener
 * via recordAgentExited.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Id } from '../../../../api.js';
import type { DaemonDeps } from '../../daemon-start/deps.js';
import { DaemonEventBus } from '../../daemon-start/event-bus.js';
import type { DaemonContext } from '../../daemon-start/types.js';
import { OpenCodeAgentService } from '../../../../infrastructure/services/remote-agents/opencode/index.js';

// ---------------------------------------------------------------------------
// Mock module-level imports (same pattern as stop-agent.test.ts)
// ---------------------------------------------------------------------------

vi.mock('@workspace/backend/config/reliability.js', () => ({
  DAEMON_HEARTBEAT_INTERVAL_MS: 30_000,
}));

vi.mock('../../pid.js', () => ({
  acquireLock: vi.fn(() => true),
  releaseLock: vi.fn(),
}));

vi.mock('../../../../api.js', () => ({
  api: {
    machines: {
      updateSpawnedAgent: 'machines.updateSpawnedAgent',
      getAgentConfigs: 'machines.getAgentConfigs',
      ackCommand: 'machines.ackCommand',
      register: 'machines.register',
      daemonHeartbeat: 'machines.daemonHeartbeat',
      updateDaemonStatus: 'machines.updateDaemonStatus',
    },
    participants: {
      leave: 'participants.leave',
      updateAgentStatus: 'participants.updateAgentStatus',
    },
    messages: {
      getInitPrompt: 'messages.getInitPrompt',
    },
  },
}));

vi.mock('../../../../infrastructure/auth/storage.js', () => ({
  getSessionId: vi.fn(() => 'test-session'),
  getOtherSessionUrls: vi.fn(() => []),
}));

vi.mock('../../../../infrastructure/convex/client.js', () => ({
  getConvexUrl: vi.fn(() => 'http://test:3210'),
  getConvexClient: vi.fn(),
  getConvexWsClient: vi.fn(),
}));

vi.mock('../../../../infrastructure/machine/index.js', () => ({
  clearAgentPid: vi.fn(),
  getMachineId: vi.fn(() => 'test-machine'),
  listAgentEntries: vi.fn(() => []),
  loadMachineConfig: vi.fn(() => null),
  persistAgentPid: vi.fn(),
}));

vi.mock('../../../../infrastructure/machine/intentional-stops.js', () => ({
  markIntentionalStop: vi.fn(),
  consumeIntentionalStop: vi.fn(() => false),
  clearIntentionalStop: vi.fn(),
}));

vi.mock('../../../../utils/error-formatting.js', () => ({
  isNetworkError: vi.fn(() => false),
  formatConnectivityError: vi.fn(),
}));

vi.mock('../../../../version.js', () => ({
  getVersion: vi.fn(() => '1.0.0'),
}));

// ---------------------------------------------------------------------------
// Import function under test (after mocks are set up)
// ---------------------------------------------------------------------------

const { onAgentShutdown } = await import('./index.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockDeps(overrides?: Partial<DaemonDeps>): DaemonDeps {
  return {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue({ configs: [] }),
    },
    processes: {
      kill: vi.fn(),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    },
    stops: {
      mark: vi.fn(),
      consume: vi.fn(() => false),
      clear: vi.fn(),
    },
    machine: {
      clearAgentPid: vi.fn(),
      persistAgentPid: vi.fn(),
      listAgentEntries: vi.fn(() => []),
    },
    clock: {
      now: () => Date.now(),
      delay: vi.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
}

function createCtx(deps: DaemonDeps): DaemonContext {
  return {
    client: {} as DaemonContext['client'],
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null as unknown as DaemonContext['config'],
    deps,
    events: new DaemonEventBus(),
    agentServices: new Map([
      [
        'opencode',
        new OpenCodeAgentService({
          execSync: vi.fn(),
          spawn: vi.fn() as any,
          kill: vi.fn(),
        }),
      ],
    ]),
  };
}

const CHATROOM_ID = 'test-chatroom-123' as Id<'chatroom_rooms'>;
const ROLE = 'builder';
const PID = 1234;

function createOptions(
  overrides?: Partial<{ chatroomId: string; role: string; pid: number; skipKill?: boolean }>
) {
  return {
    chatroomId: CHATROOM_ID,
    role: ROLE,
    pid: PID,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('onAgentShutdown', () => {
  let deps: DaemonDeps;
  let ctx: DaemonContext;

  beforeEach(() => {
    deps = createMockDeps();
    ctx = createCtx(deps);
  });

  // ─── Test 1: marks intentional stop before killing ───────────────────────

  it('marks intentional stop before killing', async () => {
    // Setup: kill(signal=0) throws ESRCH (process dies after SIGTERM)
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
    );

    // Track call order
    const callOrder: string[] = [];
    vi.mocked(deps.stops.mark).mockImplementation(() => {
      callOrder.push('stops.mark');
    });
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') {
          callOrder.push(`kill(${pid}, ${String(signal)})`);
          return;
        }
        if (signal === 0) {
          callOrder.push(`kill(${pid}, 0)`);
          throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        }
      }
    );

    await onAgentShutdown(ctx, createOptions());

    // stops.mark must be called with correct args
    expect(deps.stops.mark).toHaveBeenCalledWith(CHATROOM_ID, ROLE);

    // stops.mark must appear before any kill call
    const markIndex = callOrder.indexOf('stops.mark');
    const firstKillIndex = callOrder.findIndex((c) => c.startsWith('kill('));
    expect(markIndex).toBeGreaterThanOrEqual(0);
    expect(markIndex).toBeLessThan(firstKillIndex);
  });

  // ─── Test 2: clears local PID only after confirming process is dead ───────

  it('clears local PID only after confirming process is dead', async () => {
    // Setup: kill(signal=0) throws ESRCH after SIGTERM — process is dead
    const callOrder: string[] = [];

    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
        if (signal === 0) {
          callOrder.push(`kill(${pid}, 0)`);
          throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
        }
      }
    );
    vi.mocked(deps.machine.clearAgentPid).mockImplementation(() => {
      callOrder.push('clearAgentPid');
    });

    await onAgentShutdown(ctx, createOptions());

    // clearAgentPid MUST be called (process was confirmed dead)
    expect(deps.machine.clearAgentPid).toHaveBeenCalledWith('test-machine', CHATROOM_ID, ROLE);

    // clearAgentPid must come AFTER at least one kill(pid, 0) check
    const killCheckIndex = callOrder.findIndex((c) => c.startsWith(`kill(${PID}, 0)`));
    const clearPidIndex = callOrder.indexOf('clearAgentPid');
    expect(killCheckIndex).toBeGreaterThanOrEqual(0);
    expect(clearPidIndex).toBeGreaterThan(killCheckIndex);
  });

  // ─── Test 3: does NOT clear local PID if process never confirmed dead ─────

  it('does NOT clear local PID if process never confirmed dead', async () => {
    // Setup: kill(signal=0) never throws — process appears alive throughout
    vi.mocked(deps.processes.kill).mockImplementation(
      (_pid: number, _signal?: NodeJS.Signals | number) => {
        // Never throw — process is always alive
      }
    );

    // Use fake timers + advance time on each delay() call to skip polling loop
    // Without this, the while loop spins millions of times (delay mocked to 0ms)
    vi.useFakeTimers();
    vi.mocked(deps.clock.delay).mockImplementation(async (ms: number) => {
      vi.advanceTimersByTime(ms);
    });
    ctx = createCtx(deps);

    let result: Awaited<ReturnType<typeof onAgentShutdown>>;
    try {
      result = await onAgentShutdown(ctx, createOptions());
    } finally {
      vi.useRealTimers();
    }

    // clearAgentPid must NOT be called (process never confirmed dead)
    expect(deps.machine.clearAgentPid).not.toHaveBeenCalled();
    expect(result!.killed).toBe(false);
  });

  // ─── Test 4: does NOT call backend mutations (backend handled by event listener) ─

  it('does NOT call backend updateSpawnedAgent or participants.leave', async () => {
    // Setup: kill(signal=0) throws ESRCH after SIGTERM — process is dead
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM' || signal === 'SIGKILL') return;
        if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
    );

    await onAgentShutdown(ctx, createOptions());

    // Backend mutations must NOT be called — backend cleanup is done by recordAgentExited
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  // ─── Test 5: handles exception from stops.mark gracefully ────────────────

  it('handles exception from stops.mark gracefully', async () => {
    // Setup: stops.mark throws
    vi.mocked(deps.stops.mark).mockImplementation(() => {
      throw new Error('stops.mark failed');
    });

    // kill(signal=0) throws after first check so the function can complete
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
    );

    // Must not throw
    await expect(onAgentShutdown(ctx, createOptions())).resolves.toBeDefined();

    // Still attempts to kill process
    expect(deps.processes.kill).toHaveBeenCalledWith(-PID, 'SIGTERM');
  });

  // ─── Test 6: handles exception from processes.kill SIGTERM gracefully ────

  it('handles exception from processes.kill SIGTERM gracefully', async () => {
    // Setup: SIGTERM kill throws non-ESRCH error (EPERM)
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM') throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
        if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
    );

    // Must not throw
    await expect(onAgentShutdown(ctx, createOptions())).resolves.toBeDefined();

    // Still proceeds to wait/check loop — kill(pid, 0) should be attempted
    const signal0Calls = vi
      .mocked(deps.processes.kill)
      .mock.calls.filter(([, signal]) => signal === 0);
    expect(signal0Calls.length).toBeGreaterThan(0);
  });

  // ─── Test 7: handles exception from kill signal-0 check (treats as dead) ─

  it('handles exception from processes.kill signal-0 check gracefully (treats as dead)', async () => {
    // Setup: kill(pid, 0) throws any error — treated as process gone
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM') return;
        if (signal === 0) throw new Error('unexpected-error');
      }
    );

    const result = await onAgentShutdown(ctx, createOptions());

    expect(result.killed).toBe(true);
    expect(deps.machine.clearAgentPid).toHaveBeenCalled();
  });

  // ─── Test 8: handles exception from machine.clearAgentPid gracefully ────

  it('handles exception from machine.clearAgentPid gracefully', async () => {
    // Setup: kill(pid, 0) throws ESRCH — process confirmed dead
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
    );

    // Setup: clearAgentPid throws
    vi.mocked(deps.machine.clearAgentPid).mockImplementation(() => {
      throw new Error('clearAgentPid failed');
    });

    // Must not throw
    await expect(onAgentShutdown(ctx, createOptions())).resolves.toBeDefined();

    // No backend mutations should be called (backend cleanup is via event listener)
    expect(deps.backend.mutation).not.toHaveBeenCalled();
  });

  // ─── Test 9: happy path — returns killed=true when process dies ──────────

  it('returns killed=true when process dies after SIGTERM', async () => {
    // Setup: kill(signal=0) throws after SIGTERM
    vi.mocked(deps.processes.kill).mockImplementation(
      (pid: number, signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGTERM') return;
        if (signal === 0) throw Object.assign(new Error('ESRCH'), { code: 'ESRCH' });
      }
    );

    const result = await onAgentShutdown(ctx, createOptions());

    expect(result.killed).toBe(true);
    expect(result.cleaned).toBe(true);
  });

  // ─── Test 10: returns killed=false when process survives all attempts ─────

  it('returns killed=false when process survives all kill attempts', async () => {
    // Setup: kill(signal=0) never throws — stubborn process
    vi.mocked(deps.processes.kill).mockImplementation(
      (_pid: number, _signal?: NodeJS.Signals | number) => {
        // Never throw — process survives everything
      }
    );

    // Use fake timers + advance time on each delay() call to skip polling loop
    vi.useFakeTimers();
    vi.mocked(deps.clock.delay).mockImplementation(async (ms: number) => {
      vi.advanceTimersByTime(ms);
    });
    ctx = createCtx(deps);

    let result: Awaited<ReturnType<typeof onAgentShutdown>>;
    try {
      result = await onAgentShutdown(ctx, createOptions());
    } finally {
      vi.useRealTimers();
    }

    expect(result!.killed).toBe(false);
  });
});
