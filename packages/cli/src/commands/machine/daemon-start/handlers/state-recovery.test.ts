/**
 * state-recovery handler Unit Tests
 *
 * Tests recoverAgentStateEffect — delegates to AgentProcessManager.recover(),
 * registers workspaces via backend mutations, and marks orphan turns as failed.
 */

import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonEventBus } from '../../../../events/daemon/event-bus.js';
import { DaemonAgentProcessManagerService, DaemonSessionService } from '../daemon-services.js';
import { recoverAgentStateEffect } from './state-recovery.js';

// ---------------------------------------------------------------------------
// Helpers — Effect twin tests
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
    convexUrl: 'http://test:3210',
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
    resumeTurnForSlot: () => Effect.succeed(undefined as void),
    setLastInFlightTask: () => Effect.void,
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
