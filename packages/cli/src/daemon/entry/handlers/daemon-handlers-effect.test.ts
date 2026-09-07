/**
 * Daemon Handler Effect Tests
 *
 * Tests for the Effect twins of daemon handlers:
 * handlePingEffect and handleStatusEffect.
 */

import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handlePingEffect } from './ping.js';
import { handleStatusEffect } from './status.js';
import { DaemonSessionService } from '../daemon-services.js';
import type { MachineConfig, ConvexClient } from '../daemon-types.js';
import { DaemonEventBus } from '../events/event-bus.js';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../api.js', () => ({
  api: {
    machines: {
      getMachineAgentConfigs: 'machines.getMachineAgentConfigs',
      updateSpawnedAgent: 'machines.updateSpawnedAgent',
      recordAgentExited: 'machines.recordAgentExited',
    },
    workspaces: {
      registerWorkspace: 'workspaces.registerWorkspace',
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers — DaemonSessionService (used by handleStatusEffect)
// ---------------------------------------------------------------------------

function makeSessionLayer(config: MachineConfig | null = null): Layer.Layer<DaemonSessionService> {
  return Layer.succeed(DaemonSessionService, {
    sessionId: 'test-session-id',
    machineId: 'test-machine-id',
    convexUrl: 'http://test:3210',
    client: {} as ConvexClient,
    config,
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
      query: vi.fn().mockResolvedValue(undefined),
    } as any,
    fs: { stat: vi.fn() } as any,
    agentServices: new Map(),
    events: new DaemonEventBus(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
    logEvent: async () => undefined,
  });
}

async function runWithSession<A>(
  effect: Effect.Effect<A, never, DaemonSessionService>,
  config: MachineConfig | null = null
) {
  return Effect.runPromise(effect.pipe(Effect.provide(makeSessionLayer(config))));
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
  it('returns { result: "pong", failed: false } and logs response', async () => {
    const result = await Effect.runPromise(handlePingEffect);
    expect(result.result).toBe('pong');
    expect(result.failed).toBe(false);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('pong'));
  });
});

// ---------------------------------------------------------------------------
// handleStatusEffect
// ---------------------------------------------------------------------------

describe('handleStatusEffect', () => {
  it('returns JSON with hostname/os/availableHarnesses from config', async () => {
    const config = {
      hostname: 'my-host',
      os: 'darwin',
      availableHarnesses: ['opencode'],
    } as unknown as MachineConfig;

    const result = await runWithSession(handleStatusEffect, config);
    const parsed = JSON.parse(result.result);

    expect(parsed.hostname).toBe('my-host');
    expect(parsed.os).toBe('darwin');
    expect(parsed.availableHarnesses).toEqual(['opencode']);
    expect(result.failed).toBe(false);
  });

  it('returns nulls when config is null', async () => {
    const result = await runWithSession(handleStatusEffect, null);
    const parsed = JSON.parse(result.result);

    expect(parsed.hostname).toBeUndefined();
    expect(parsed.os).toBeUndefined();
    expect(parsed.availableHarnesses).toBeUndefined();
    expect(result.failed).toBe(false);
  });

  it('returns empty array when config has no harnesses', async () => {
    const config = {
      hostname: 'test',
      os: 'linux',
      availableHarnesses: [],
    } as unknown as MachineConfig;

    const result = await runWithSession(handleStatusEffect, config);
    const parsed = JSON.parse(result.result);

    expect(parsed.availableHarnesses).toEqual([]);
    expect(result.failed).toBe(false);
  });
});
