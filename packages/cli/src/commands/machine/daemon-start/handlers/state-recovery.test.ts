/**
 * state-recovery handler Unit Tests
 *
 * Tests recoverAgentState — delegates to AgentProcessManager.recover(),
 * registers workspaces via backend mutations, and marks orphan turns as failed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import { OpenCodeAgentService } from '../../../../infrastructure/services/remote-agents/opencode/index.js';
import type { DaemonDeps } from '../deps.js';
import type { DaemonContext } from '../types.js';
import { recoverAgentState } from './state-recovery.js';
import { createMockDaemonDeps } from '../testing/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(overrides?: {
  activeSlots?: { chatroomId: string; role: string; slot: any }[];
  configs?: { machineId: string; workingDir?: string; role?: string }[];
  managedSessions?: {
    harnessSessionId: string;
    chatroomId: string;
    workspaceId: string;
    status: string;
  }[];
}): DaemonContext {
  const deps: DaemonDeps = createMockDaemonDeps();

  // Configure agentProcessManager mock
  vi.mocked(deps.agentProcessManager.listActive).mockReturnValue(overrides?.activeSlots ?? []);

  // Configure backend query to handle both getMachineAgentConfigs and getMachineHarnessSessions
  vi.mocked(deps.backend.query).mockImplementation((_api: any, args: any) => {
    // If it's a harness sessions query (has machineId but not chatroomId)
    if (args && 'machineId' in args && !('chatroomId' in args)) {
      return Promise.resolve(overrides?.managedSessions ?? []);
    }
    // Otherwise it's getMachineAgentConfigs
    return Promise.resolve({ configs: overrides?.configs ?? [] });
  });

  // Configure mutation to return { failedTurns: 0 } by default (for markOrphanTurnsFailed)
  vi.mocked(deps.backend.mutation).mockResolvedValue({ failedTurns: 0 });

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
          kill: vi.fn(),
        }),
      ],
    ]),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('recoverAgentState', () => {
  it('delegates to agentProcessManager.recover()', async () => {
    const ctx = createMockContext();

    await recoverAgentState(ctx);

    expect(ctx.deps.agentProcessManager.recover).toHaveBeenCalledOnce();
  });

  it('registers workspaces for active agents via backend mutation', async () => {
    const ctx = createMockContext({
      activeSlots: [
        { chatroomId: 'room-1', role: 'builder', slot: { state: 'running', pid: 100 } },
      ],
      configs: [{ machineId: 'test-machine-id', workingDir: '/tmp/workspace', role: 'builder' }],
    });

    await recoverAgentState(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(), // api.workspaces.registerWorkspace
      expect.objectContaining({
        sessionId: 'test-session-id',
        chatroomId: 'room-1',
        machineId: 'test-machine-id',
        workingDir: '/tmp/workspace',
        registeredBy: 'builder',
      })
    );
  });

  it('skips working dirs from other machines (no registerWorkspace called)', async () => {
    const ctx = createMockContext({
      activeSlots: [
        { chatroomId: 'room-1', role: 'builder', slot: { state: 'running', pid: 100 } },
      ],
      configs: [{ machineId: 'other-machine', workingDir: '/tmp/other' }],
    });

    await recoverAgentState(ctx);

    // mutation should not have been called for workspace registration
    // (orphan cleanup mutations may still be called for orphaned sessions)
    const mutationCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls;
    const registerCalls = mutationCalls.filter((call) =>
      JSON.stringify(call[1]).includes('/tmp/other')
    );
    expect(registerCalls).toHaveLength(0);
  });

  it('re-registers spawnedAgentPid for recovered active agents', async () => {
    const ctx = createMockContext({
      activeSlots: [
        {
          chatroomId: 'room-1',
          role: 'builder',
          slot: { state: 'running', pid: 4242, model: 'gpt-4' },
        },
      ],
      configs: [],
    });

    await recoverAgentState(ctx);

    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'test-session-id',
        machineId: 'test-machine-id',
        chatroomId: 'room-1',
        role: 'builder',
        pid: 4242,
        model: 'gpt-4',
        reason: 'daemon.recovery',
      })
    );
  });

  it('handles no active agents after recovery', async () => {
    const ctx = createMockContext({ activeSlots: [] });

    await recoverAgentState(ctx);

    expect(ctx.deps.agentProcessManager.recover).toHaveBeenCalledOnce();
    // Orphan cleanup still runs — no registerWorkspace mutations
    const mutationCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls;
    const registerCalls = mutationCalls.filter((call) =>
      JSON.stringify(call[1] ?? {}).includes('workingDir')
    );
    expect(registerCalls).toHaveLength(0);
  });

  // ── Orphan turn cleanup ─────────────────────────────────────────────────────

  it('marks orphan turns as failed for sessions not in active slots', async () => {
    const ctx = createMockContext({
      activeSlots: [
        { chatroomId: 'room-1', role: 'builder', slot: { state: 'running', pid: 100 } },
      ],
      configs: [],
      managedSessions: [
        // room-1 is active — not an orphan
        {
          harnessSessionId: 'session-1',
          chatroomId: 'room-1',
          workspaceId: 'ws-1',
          status: 'active',
        },
        // room-2 is not in active slots — orphan
        {
          harnessSessionId: 'session-2',
          chatroomId: 'room-2',
          workspaceId: 'ws-2',
          status: 'idle',
        },
      ],
    });

    await recoverAgentState(ctx);

    // markOrphanTurnsFailed should be called for session-2 only
    const mutationCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls;
    const orphanCalls = mutationCalls.filter((call) =>
      JSON.stringify(call[1]).includes('session-2')
    );
    expect(orphanCalls).toHaveLength(1);

    const notOrphanCalls = mutationCalls.filter((call) =>
      JSON.stringify(call[1]).includes('session-1')
    );
    expect(notOrphanCalls).toHaveLength(0);
  });

  it('treats all sessions as orphans when activeSlots is empty', async () => {
    const ctx = createMockContext({
      activeSlots: [],
      managedSessions: [
        {
          harnessSessionId: 'session-A',
          chatroomId: 'room-A',
          workspaceId: 'ws-A',
          status: 'idle',
        },
        {
          harnessSessionId: 'session-B',
          chatroomId: 'room-B',
          workspaceId: 'ws-B',
          status: 'active',
        },
      ],
    });

    await recoverAgentState(ctx);

    const mutationCalls = vi.mocked(ctx.deps.backend.mutation).mock.calls;
    const orphanCallArgs = mutationCalls.map((call) => JSON.stringify(call[1]));
    expect(orphanCallArgs.some((a) => a.includes('session-A'))).toBe(true);
    expect(orphanCallArgs.some((a) => a.includes('session-B'))).toBe(true);
  });

  it('continues processing remaining sessions when markOrphanTurnsFailed throws for one', async () => {
    let callCount = 0;
    const ctx = createMockContext({
      activeSlots: [],
      managedSessions: [
        {
          harnessSessionId: 'session-fail',
          chatroomId: 'room-X',
          workspaceId: 'ws-X',
          status: 'idle',
        },
        {
          harnessSessionId: 'session-ok',
          chatroomId: 'room-Y',
          workspaceId: 'ws-Y',
          status: 'idle',
        },
      ],
    });

    vi.mocked(ctx.deps.backend.mutation).mockImplementation((_api: any, args: any) => {
      callCount++;
      if (JSON.stringify(args).includes('session-fail')) {
        return Promise.reject(new Error('simulated failure'));
      }
      return Promise.resolve({ failedTurns: 0 });
    });

    // Should not throw — errors are caught per-session
    await expect(recoverAgentState(ctx)).resolves.not.toThrow();

    // Both sessions should have been attempted
    expect(callCount).toBe(2);
    expect(console.warn).toHaveBeenCalled();
  });

  it('logs a summary when orphan turns are marked as failed', async () => {
    const ctx = createMockContext({
      activeSlots: [],
      managedSessions: [
        {
          harnessSessionId: 'session-orphan',
          chatroomId: 'room-Z',
          workspaceId: 'ws-Z',
          status: 'idle',
        },
      ],
    });

    vi.mocked(ctx.deps.backend.mutation).mockResolvedValue({ failedTurns: 3 });

    await recoverAgentState(ctx);

    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🧹'));
  });
});
