/**
 * Model refresh — concurrent pushes must not lose per-harness updates.
 *
 * Drives startBackgroundModelDiscoveryEffect / refreshModelsEffect through the
 * real daemon layers (daemonSessionToLayers). Substitutes only the ports:
 * backend mutation, catalog query client, harness services, generated api refs,
 * and machine registration.
 */

import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import type { DaemonSessionInit } from './daemon-types.js';
import { refreshModelsEffect, startBackgroundModelDiscoveryEffect } from './models-refresh.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import type * as MachineModule from '../../infrastructure/machine/index.js';
import type { RemoteAgentService } from '../infrastructure/local/harness/services/remote-agent-service.js';

vi.mock('../../api.js', () => ({
  api: {
    machines: { refreshCapabilities: 'mock-refreshCapabilities' },
    harnesses: {
      claude: { listModels: 'mock-claude-listModels' },
      claudeSdk: { listModels: 'mock-claudeSdk-listModels' },
    },
  },
}));

vi.mock('../../infrastructure/machine/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof MachineModule>()),
  ensureMachineRegistered: vi.fn().mockResolvedValue({
    machineId: 'test-machine-id',
    hostname: 'test-host',
    os: 'darwin',
    registeredAt: '2026-01-01T00:00:00Z',
    lastSyncedAt: '2026-01-01T00:00:00Z',
    availableHarnesses: [],
    harnessVersions: {},
  }),
}));

const OLD = ['anthropic/claude-fable-5-1'];
const NEW = ['anthropic/claude-fable-5-2', 'anthropic/claude-fable-5-1'];
const PI_CACHED = ['pi/p1'];
const PI_DISCOVERED = ['pi/p1', 'pi/p2'];

/** What the backend must hold once every harness has been discovered. */
const EXPECTED_FINAL = { claude: NEW, 'claude-sdk': NEW, pi: PI_DISCOVERED };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Records how many calls are in flight at once. */
function concurrencyProbe() {
  let inFlight = 0;
  const probe = { max: 0 };
  const track = async <T>(work: () => Promise<T>): Promise<T> => {
    inFlight++;
    probe.max = Math.max(probe.max, inFlight);
    try {
      return await work();
    } finally {
      inFlight--;
    }
  };
  return { probe, track };
}

function setup() {
  const discovery = concurrencyProbe();
  const pushes = concurrencyProbe();
  const pushedSnapshots: Record<string, string[]>[] = [];

  const harness = (models: string[], delayMs: number) =>
    ({
      isInstalled: async () => true,
      listModels: () => discovery.track(() => sleep(delayMs).then(() => models)),
    }) as unknown as RemoteAgentService;

  const mutation = vi.fn((_ref: unknown, args: { availableModels: Record<string, string[]> }) =>
    pushes.track(async () => {
      pushedSnapshots.push(args.availableModels);
      await sleep(10);
      return null;
    })
  );

  // Catalog (server source of truth) already has fable 5.2 for both Claude harnesses.
  const catalogQuery = vi.fn(async (ref: unknown) => {
    if (ref === 'mock-claude-listModels' || ref === 'mock-claudeSdk-listModels') return NEW;
    throw new Error(`unexpected catalog query ${String(ref)}`);
  });

  const init: DaemonSessionInit = createMockDaemonSessionInit({
    client: { query: catalogQuery } as unknown as DaemonSessionInit['client'],
    backend: { mutation, query: vi.fn() },
    config: {
      machineId: 'test-machine-id',
      hostname: 'test-host',
      os: 'darwin',
      registeredAt: '2026-01-01T00:00:00Z',
      lastSyncedAt: '2026-01-01T00:00:00Z',
      availableHarnesses: [],
      harnessVersions: {},
    } as unknown as DaemonSessionInit['config'],
    // Catalog-backed harnesses discover locally as [] (stub); the catalog overlay supplies NEW.
    agentServices: new Map<string, RemoteAgentService>([
      ['claude', harness([], 1)],
      ['claude-sdk', harness([], 1)],
      ['pi', harness(PI_DISCOVERED, 30)],
    ]),
    // Startup cache from the backend: stale Claude lists.
    lastPushedModels: { claude: OLD, 'claude-sdk': OLD, pi: PI_CACHED },
    lastPushedHarnessFingerprint: null,
  });

  return { init, pushedSnapshots, discoveryProbe: discovery.probe, pushProbe: pushes.probe };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('startBackgroundModelDiscoveryEffect — concurrent harness pushes', () => {
  it('keeps every harness update in the last pushed snapshot (no lost update)', async () => {
    const { init, pushedSnapshots, pushProbe } = setup();

    await Effect.runPromise(
      startBackgroundModelDiscoveryEffect.pipe(Effect.provide(daemonSessionToLayers(init)))
    );

    expect(pushedSnapshots.at(-1)).toEqual(EXPECTED_FINAL);
    expect(pushProbe.max).toBe(1);
  });

  it('still discovers all harnesses concurrently', async () => {
    const { init, discoveryProbe } = setup();

    await Effect.runPromise(
      startBackgroundModelDiscoveryEffect.pipe(Effect.provide(daemonSessionToLayers(init)))
    );

    expect(discoveryProbe.max).toBe(3);
  });
});

describe('refreshModelsEffect — shares state and lock with background discovery', () => {
  it('never pushes concurrently with background discovery on the same daemon layers', async () => {
    const { init, pushedSnapshots, pushProbe } = setup();
    const layers = daemonSessionToLayers(init);

    // Same shape as production: separate runs (runFork / runPromise) providing one layers object.
    await Promise.all([
      Effect.runPromise(startBackgroundModelDiscoveryEffect.pipe(Effect.provide(layers))),
      Effect.runPromise(refreshModelsEffect.pipe(Effect.provide(layers))),
    ]);

    expect(pushProbe.max).toBe(1);
    expect(pushedSnapshots.at(-1)).toEqual(EXPECTED_FINAL);
  });

  it('sees what background discovery pushed, so an unchanged manual refresh is skipped', async () => {
    const { init, pushedSnapshots } = setup();
    const layers = daemonSessionToLayers(init);

    await Effect.runPromise(startBackgroundModelDiscoveryEffect.pipe(Effect.provide(layers)));
    const pushesAfterBackground = pushedSnapshots.length;
    const outcome = await Effect.runPromise(refreshModelsEffect.pipe(Effect.provide(layers)));

    expect(outcome).toEqual({ kind: 'skipped_no_changes' });
    expect(pushedSnapshots.length).toBe(pushesAfterBackground);
  });
});
