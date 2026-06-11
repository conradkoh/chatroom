/**
 * state-recovery handler Unit Tests
 *
 * Tests recoverAgentState — delegates to AgentProcessManager.recover(),
 * registers workspaces via backend mutations, and marks orphan turns as failed.
 *
 * Also tests recoverAgentStateEffect directly (E5.3 Effect twin).
 */

import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import { OpenCodeAgentService } from '../../../../infrastructure/services/remote-agents/opencode/index.js';
import { DaemonAgentProcessManagerService, DaemonSessionService } from '../daemon-services.js';
import type { DaemonDeps } from '../deps.js';
import type { DaemonContext } from '../types.js';
import { recoverAgentState, recoverAgentStateEffect } from './state-recovery.js';
import { createMockDaemonDeps } from '../testing/index.js';

// ---------------------------------------------------------------------------
// Helpers — deprecated-wrapper tests (existing 8 tests)
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
// Helpers — Effect twin tests (E5.3)
// ---------------------------------------------------------------------------

function makeSessionLayer(overrides?: {
  sessionId?: string;
  machineId?: string;
  backendQuery?: ReturnType<typeof vi.fn>;
  backendMutation?: ReturnType<typeof vi.fn>;
}): Layer.Layer<DaemonSessionService> {
  // Default query mock distinguishes getMachineHarnessSessions (returns [])
  // from getMachineAgentConfigs (returns { configs: [] }) based on args shape.
  const defaultQuery = vi.fn().mockImplementation((_api: any, args: any) => {
    if (args && 'machineId' in args && !('chatroomId' in args)) {
      return Promise.resolve([]); // getMachineHarnessSessions
    }
    return Promise.resolve({ configs: [] }); // getMachineAgentConfigs
  });

  return Layer.succeed(DaemonSessionService, {
    sessionId: overrides?.sessionId ?? 'test-session-id',
    machineId: overrides?.machineId ?? 'test-machine-id',
    client: {},
    config: null,
    backend: {
      query: overrides?.backendQuery ?? defaultQuery,
      mutation: overrides?.backendMutation ?? vi.fn().mockResolvedValue({ failedTurns: 0 }),
    } as any,
    fs: { stat: vi.fn().mockResolvedValue({ isDirectory: () => true }) } as any,
    agentServices: new Map(),
    events: new DaemonEventBus(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
  });
}

function makeApmLayer(overrides?: {
  recover?: () => Effect.Effect<void>;
  listActive?: () => { chatroomId: string; role: string; slot: any }[];
}): Layer.Layer<DaemonAgentProcessManagerService> {
  return Layer.succeed(DaemonAgentProcessManagerService, {
    recover: overrides?.recover ?? (() => Effect.succeed(undefined as void)),
    listActive: overrides?.listActive ?? (() => []),
    ensureRunning: (_opts: any) => Effect.succeed({ type: 'started', pid: 0 } as any),
    stop: (_opts: any) => Effect.succeed({ success: true }),
    handleExit: (_opts: any) => Effect.succeed(undefined as void),
    getSlot: vi.fn().mockReturnValue(undefined),
    whenTurnEndsIdle: () => Effect.succeed(undefined as void),
  });
}

async function runWithLayers(
  sessionOverrides?: Parameters<typeof makeSessionLayer>[0],
  apmOverrides?: Parameters<typeof makeApmLayer>[0]
) {
  return Effect.runPromise(
    recoverAgentStateEffect.pipe(
      Effect.provide(Layer.merge(makeSessionLayer(sessionOverrides), makeApmLayer(apmOverrides)))
    )
  );
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
// Tests — deprecated wrapper (existing 8 tests, unchanged)
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

// ---------------------------------------------------------------------------
// Tests — Effect twin (E5.3 split-at-seam)
// ---------------------------------------------------------------------------

describe('recoverAgentStateEffect', () => {
  it('calls agentMgr.recover() via the Effect service', async () => {
    const recoverSpy = vi.fn(() => Effect.succeed(undefined as void));
    await runWithLayers(undefined, { recover: recoverSpy, listActive: () => [] });
    expect(recoverSpy).toHaveBeenCalledOnce();
  });

  it('logs "No active agents" when listActive returns empty', async () => {
    await runWithLayers(undefined, { listActive: () => [] });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No active agents'));
  });

  it('registers workspaces using session.backend for active agents', async () => {
    const backendMutation = vi.fn().mockResolvedValue({ failedTurns: 0 });
    const backendQuery = vi.fn().mockImplementation((_api: any, args: any) => {
      if (args && 'machineId' in args && !('chatroomId' in args)) {
        return Promise.resolve([]); // no managed sessions
      }
      return Promise.resolve({
        configs: [{ machineId: 'test-machine-id', workingDir: '/tmp/ws', role: 'builder' }],
      });
    });

    await runWithLayers(
      { backendQuery, backendMutation },
      {
        listActive: () => [
          { chatroomId: 'room-1', role: 'builder', slot: { state: 'running', pid: 42 } as any },
        ],
      }
    );

    expect(backendMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        chatroomId: 'room-1',
        workingDir: '/tmp/ws',
        registeredBy: 'builder',
      })
    );
  });

  it('marks orphan sessions using session.backend', async () => {
    const backendMutation = vi.fn().mockResolvedValue({ failedTurns: 2 });
    const backendQuery = vi.fn().mockImplementation((_api: any, args: any) => {
      if (args && 'machineId' in args && !('chatroomId' in args)) {
        return Promise.resolve([
          {
            harnessSessionId: 'hs-orphan',
            chatroomId: 'room-orphan',
            workspaceId: 'ws-o',
            status: 'idle',
          },
        ]);
      }
      return Promise.resolve({ configs: [] });
    });

    await runWithLayers({ backendQuery, backendMutation }, { listActive: () => [] });

    expect(backendMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ harnessSessionId: 'hs-orphan' })
    );
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('🧹'));
  });

  // ── Regression: error-isolation boundaries must survive ─────────────────────
  // The split-at-seam design keeps try/catch in recoverAgentStatePostRecoveryCore
  // (plain async) so per-chatroom and per-session errors never abort the whole
  // recovery. This test would have FAILED with the try/catch-in-Effect.gen approach.

  it('continues when getMachineAgentConfigs rejects for one chatroom (error isolation)', async () => {
    let queryCallCount = 0;
    const backendQuery = vi.fn().mockImplementation((_api: any, args: any) => {
      if (args && 'machineId' in args && !('chatroomId' in args)) {
        return Promise.resolve([]); // getMachineHarnessSessions — no orphans
      }
      // getMachineAgentConfigs: first call fails, second succeeds
      queryCallCount++;
      if (queryCallCount === 1) {
        return Promise.reject(new Error('transient network error'));
      }
      return Promise.resolve({ configs: [] }); // second chatroom: no matching configs
    });

    // Two active chatrooms — getMachineAgentConfigs called for each
    await expect(
      runWithLayers(
        { backendQuery },
        {
          listActive: () => [
            { chatroomId: 'room-fail', role: 'builder', slot: {} as any },
            { chatroomId: 'room-ok', role: 'builder', slot: {} as any },
          ],
        }
      )
    ).resolves.toBeUndefined();

    // Both chatrooms were attempted (queryCallCount === 2)
    expect(queryCallCount).toBe(2);
  });

  it('skips a chatroom whose getMachineAgentConfigs rejects and continues to the next', async () => {
    const backendMutation = vi.fn().mockResolvedValue({ failedTurns: 0 });
    const backendQuery = vi.fn().mockImplementation((_api: any, args: any) => {
      if (args && 'machineId' in args && !('chatroomId' in args)) return Promise.resolve([]); // getMachineHarnessSessions
      if (args.chatroomId === 'room-1') return Promise.reject(new Error('boom')); // configs fails for room-1
      return Promise.resolve({
        configs: [{ machineId: 'test-machine-id', workingDir: '/tmp/ws2', role: 'builder' }],
      }); // room-2 ok
    });

    await expect(
      runWithLayers(
        { backendQuery, backendMutation },
        {
          listActive: () => [
            { chatroomId: 'room-1', role: 'builder', slot: { state: 'running', pid: 1 } as any },
            { chatroomId: 'room-2', role: 'builder', slot: { state: 'running', pid: 2 } as any },
          ],
        }
      )
    ).resolves.toBeUndefined();

    // room-2 registered despite room-1's configs query rejecting ⇒ `continue` worked
    expect(backendMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ chatroomId: 'room-2', workingDir: '/tmp/ws2' })
    );
  });
});
