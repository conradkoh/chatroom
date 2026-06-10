/**
 * Daemon Handler Effect Tests (Phase D1)
 *
 * Tests for the Effect twins of four simple daemon handlers:
 * handlePingEffect, handleStatusEffect, executeStopAgentEffect,
 * handleStopAgentEffect, and recoverAgentStateEffect.
 *
 * Uses DaemonContextService + Layer for pure dependency injection —
 * no process.exit, no real network calls.
 */

import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DaemonContextService } from '../daemon-context-service.js';
import { handlePingEffect } from './ping.js';
import { recoverAgentStateEffect } from './state-recovery.js';
import { handleStatusEffect } from './status.js';
import { executeStopAgentEffect, handleStopAgentEffect } from './stop-agent.js';
import { createMockDaemonContext } from '../testing/index.js';
import { createMockDaemonDeps } from '../testing/mock-daemon-deps.js';
import type { DaemonContext, MachineConfig } from '../types.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../../api.js', () => ({
  api: {
    machines: {
      getMachineAgentConfigs: 'machines.getMachineAgentConfigs',
      updateSpawnedAgent: 'machines.updateSpawnedAgent',
      recordAgentExited: 'machines.recordAgentExited',
    },
    workspaces: {
      registerWorkspace: 'workspaces.registerWorkspace',
    },
    daemon: {
      directHarness: {
        turns: {
          getMachineHarnessSessions: 'daemon.directHarness.turns.getMachineHarnessSessions',
          markOrphanTurnsFailed: 'daemon.directHarness.turns.markOrphanTurnsFailed',
        },
      },
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLayer(overrides?: Partial<DaemonContext>) {
  return Layer.succeed(DaemonContextService, createMockDaemonContext(overrides));
}

async function run<A>(
  effect: Effect.Effect<A, never, DaemonContextService>,
  overrides?: Partial<DaemonContext>
) {
  return Effect.runPromise(effect.pipe(Effect.provide(makeLayer(overrides))));
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
// handlePingEffect
// ---------------------------------------------------------------------------

describe('handlePingEffect', () => {
  it('returns { result: "pong", failed: false }', async () => {
    const result = await run(handlePingEffect);
    expect(result.result).toBe('pong');
    expect(result.failed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// handleStatusEffect
// ---------------------------------------------------------------------------

describe('handleStatusEffect', () => {
  it('returns JSON with hostname/os/availableHarnesses from ctx.config', async () => {
    const config = {
      hostname: 'my-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
    } as unknown as MachineConfig;

    const result = await run(handleStatusEffect, { config });
    const parsed = JSON.parse(result.result);

    expect(parsed.hostname).toBe('my-host');
    expect(parsed.os).toBe('darwin');
    expect(parsed.availableHarnesses).toEqual(['opencode']);
    expect(result.failed).toBe(false);
  });

  it('returns nulls when ctx.config is null', async () => {
    const result = await run(handleStatusEffect, { config: null });
    const parsed = JSON.parse(result.result);

    expect(parsed.hostname).toBeUndefined();
    expect(parsed.os).toBeUndefined();
    expect(parsed.availableHarnesses).toBeUndefined();
    expect(result.failed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// executeStopAgentEffect
// ---------------------------------------------------------------------------

describe('executeStopAgentEffect', () => {
  it('succeeds when agentProcessManager.stop returns { success: true }', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.agentProcessManager.stop).mockResolvedValue({ success: true });

    const effect = executeStopAgentEffect({
      chatroomId: 'room-abc',
      role: 'builder',
      reason: 'user.stop',
    });

    const result = await run(effect, { deps });

    expect(result.failed).toBe(false);
    expect(result.result).toContain('builder');
  });

  it('returns { failed: true } when agentProcessManager.stop returns { success: false }', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.agentProcessManager.stop).mockResolvedValue({ success: false });

    const effect = executeStopAgentEffect({
      chatroomId: 'room-abc',
      role: 'planner',
      reason: 'user.stop',
    });

    const result = await run(effect, { deps });

    expect(result.failed).toBe(true);
    expect(result.result).toContain('planner');
  });
});

// ---------------------------------------------------------------------------
// handleStopAgentEffect
// ---------------------------------------------------------------------------

describe('handleStopAgentEffect', () => {
  it('correctly extracts chatroomId/role/reason from StopAgentCommand', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.agentProcessManager.stop).mockResolvedValue({ success: true });

    const command = {
      type: 'stop-agent' as const,
      reason: 'user.stop' as const,
      payload: {
        chatroomId: 'room-xyz',
        role: 'reviewer',
      },
    };

    const result = await run(handleStopAgentEffect(command), { deps });

    expect(deps.agentProcessManager.stop).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'room-xyz',
        role: 'reviewer',
        reason: 'user.stop',
      })
    );
    expect(result.failed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// recoverAgentStateEffect
// ---------------------------------------------------------------------------

describe('recoverAgentStateEffect', () => {
  it('calls agentProcessManager.recover() and completes', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.agentProcessManager.listActive).mockReturnValue([]);
    vi.mocked(deps.backend.query).mockResolvedValue([]); // getMachineHarnessSessions

    await run(recoverAgentStateEffect, { deps });

    expect(deps.agentProcessManager.recover).toHaveBeenCalledOnce();
  });

  it('completes even when backend.query throws (non-critical path)', async () => {
    const deps = createMockDaemonDeps();
    vi.mocked(deps.agentProcessManager.listActive).mockReturnValue([]);
    vi.mocked(deps.backend.query).mockRejectedValue(new Error('Network error'));

    // Should resolve without throwing
    await expect(run(recoverAgentStateEffect, { deps })).resolves.toBeUndefined();
  });

  it('marks orphan turns when managed sessions have no active slot', async () => {
    const deps = createMockDaemonDeps();

    // No active slots recovered
    vi.mocked(deps.agentProcessManager.listActive).mockReturnValue([]);

    // getMachineHarnessSessions returns one orphan session
    vi.mocked(deps.backend.query).mockResolvedValue([
      {
        harnessSessionId: 'harness-session-001',
        chatroomId: 'room-orphan',
        workspaceId: 'ws-001',
        status: 'active',
      },
    ]);

    // markOrphanTurnsFailed returns failedTurns count
    vi.mocked(deps.backend.mutation).mockResolvedValue({ failedTurns: 2 });

    await run(recoverAgentStateEffect, { deps, machineId: 'test-machine-id' });

    expect(deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(), // markOrphanTurnsFailed api ref
      expect.objectContaining({
        harnessSessionId: 'harness-session-001',
      })
    );
  });
});
