/**
 * state-recovery handler Unit Tests
 *
 * Tests recoverAgentState using injected dependencies.
 * Covers: no entries, alive agents, stale PIDs, mixed state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OpenCodeAgentService } from '../../../../infrastructure/services/remote-agents/opencode/index.js';
import type { DaemonDeps } from '../deps.js';
import { DaemonEventBus } from '../event-bus.js';
import type { DaemonContext } from '../types.js';
import { recoverAgentState } from './state-recovery.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(
  entries: { chatroomId: string; role: string; entry: { pid: number; harness: 'opencode' } }[],
  aliveCheck?: (pid: number) => boolean
): DaemonContext {
  const deps: DaemonDeps = {
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
    },
    processes: {
      kill: vi.fn(),
    },
    fs: {
      stat: vi.fn().mockResolvedValue({ isDirectory: () => true }),
    },
    stops: {
      mark: vi.fn(),
      consume: vi.fn().mockReturnValue(false),
      clear: vi.fn(),
    },
    machine: {
      clearAgentPid: vi.fn(),
      persistAgentPid: vi.fn(),
      listAgentEntries: vi.fn().mockReturnValue(entries),
    },
    clock: {
      now: vi.fn().mockReturnValue(Date.now()),
      delay: vi.fn().mockResolvedValue(undefined),
    },
  };

  // agentService.isAlive(pid) uses deps.kill(pid, 0) — throws => dead, no throw => alive
  const killMock = vi.fn().mockImplementation((pid: number, _signal: number | string) => {
    if (aliveCheck && !aliveCheck(pid)) {
      throw new Error('ESRCH');
    }
  });

  return {
    client: {},
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    config: null,
    deps,
    events: new DaemonEventBus(),
    agentServices: new Map([
      [
        'opencode',
        new OpenCodeAgentService({
          execSync: vi.fn(),
          spawn: vi.fn() as any,
          kill: killMock,
        }),
      ],
    ]),
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

function getAllLogOutput(): string {
  return (console.log as any).mock.calls
    .map((c: unknown[]) => (c as string[]).join(' '))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recoverAgentState', () => {
  it('logs nothing to recover when no entries exist', async () => {
    const ctx = createMockContext([]);

    await recoverAgentState(ctx);

    expect(getAllLogOutput()).toContain('nothing to recover');
    expect(ctx.deps.machine.clearAgentPid).not.toHaveBeenCalled();
  });

  it('recovers alive agents without clearing PIDs', async () => {
    const entries = [
      { chatroomId: 'room-1', role: 'builder', entry: { pid: 1234, harness: 'opencode' as const } },
    ];
    const ctx = createMockContext(entries, () => true);

    await recoverAgentState(ctx);

    const output = getAllLogOutput();
    expect(output).toContain('Recovered: builder');
    expect(output).toContain('PID 1234');
    expect(output).toContain('1 alive, 0 stale cleared');
    expect(ctx.deps.machine.clearAgentPid).not.toHaveBeenCalled();
  });

  it('clears stale PIDs for dead agents', async () => {
    const entries = [
      { chatroomId: 'room-1', role: 'planner', entry: { pid: 5678, harness: 'opencode' as const } },
    ];
    const ctx = createMockContext(entries, () => false);

    await recoverAgentState(ctx);

    const output = getAllLogOutput();
    expect(output).toContain('Stale PID 5678');
    expect(output).toContain('0 alive, 1 stale cleared');
    expect(ctx.deps.machine.clearAgentPid).toHaveBeenCalledWith(
      'test-machine-id',
      'room-1',
      'planner'
    );
  });

  it('handles mixed alive and dead agents', async () => {
    const entries = [
      { chatroomId: 'room-1', role: 'builder', entry: { pid: 100, harness: 'opencode' as const } },
      { chatroomId: 'room-1', role: 'reviewer', entry: { pid: 200, harness: 'opencode' as const } },
      { chatroomId: 'room-2', role: 'planner', entry: { pid: 300, harness: 'opencode' as const } },
    ];
    const ctx = createMockContext(entries, (pid: number) => pid === 100 || pid === 300);

    await recoverAgentState(ctx);

    const output = getAllLogOutput();
    expect(output).toContain('2 alive, 1 stale cleared');
    expect(ctx.deps.machine.clearAgentPid).toHaveBeenCalledTimes(1);
    expect(ctx.deps.machine.clearAgentPid).toHaveBeenCalledWith(
      'test-machine-id',
      'room-1',
      'reviewer'
    );
  });
});
