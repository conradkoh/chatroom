/**
 * File tree subscription Effect twin tests.
 */

import type { Layer } from 'effect';
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { daemonSessionToLayers } from './daemon-layers.js';
import { DaemonSessionService, type DaemonSessionServiceShape } from './daemon-services.js';
import { createMockDaemonSessionInit } from './testing/index.js';
import { createMockDaemonDeps } from './testing/mock-daemon-deps.js';
import type { DaemonSessionInit } from './types.js';

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      getPendingFileTreeRequests: 'mock-getPendingFileTreeRequests',
      syncFileTreeV2: 'mock-syncFileTreeV2',
      fulfillFileTreeRequest: 'mock-fulfillFileTreeRequest',
    },
  },
}));

const mockScanFileTree = vi.fn();

vi.mock('../../../infrastructure/services/workspace/file-tree-scanner.js', () => ({
  scanFileTree: (...args: unknown[]) => mockScanFileTree(...args),
}));

function makeMockWsClient(): {
  onUpdate: ReturnType<typeof vi.fn>;
} {
  return {
    onUpdate: vi.fn().mockReturnValue(vi.fn()),
  };
}

function makeSessionLayer(
  overrides?: Partial<DaemonSessionInit>
): Layer.Layer<DaemonSessionService> {
  const init = createMockDaemonSessionInit(overrides);
  return daemonSessionToLayers(init);
}

async function runWithSession<A>(
  effect: Effect.Effect<A, never, DaemonSessionService>,
  overrides?: Partial<DaemonSessionInit>
) {
  const layer = makeSessionLayer(overrides);
  return Effect.runPromise(
    Effect.gen(function* () {
      const runtime = yield* Effect.runtime<DaemonSessionService>();
      const session = yield* DaemonSessionService;
      const sessionWithRuntime = { ...session, runtime };
      return yield* effect.pipe(
        Effect.provideService(DaemonSessionService, sessionWithRuntime as DaemonSessionServiceShape)
      );
    }).pipe(Effect.provide(layer))
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  mockScanFileTree.mockResolvedValue({
    entries: [{ path: 'src/index.ts', type: 'file' }],
    scannedAt: 1_700_000_000_000,
    rootDir: '/workspace',
  });
});

describe('startFileTreeSubscriptionEffect', () => {
  it('returns a handle with a stop() method', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const wsClient = makeMockWsClient();

    const handle = await runWithSession(startFileTreeSubscriptionEffect(wsClient as any));

    expect(handle).toHaveProperty('stop');
    expect(typeof handle.stop).toBe('function');
  });

  it('calls onUpdate with sessionId and machineId from session', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const wsClient = makeMockWsClient();

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-tree',
      machineId: 'machine-tree',
    });

    expect(wsClient.onUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId: 'session-tree', machineId: 'machine-tree' }),
      expect.any(Function),
      expect.any(Function)
    );
  });

  it('fulfills pending requests via syncFileTreeV2 and fulfillFileTreeRequest', async () => {
    const { startFileTreeSubscriptionEffect } = await import('./file-tree-subscription.js');
    const deps = createMockDaemonDeps();
    vi.mocked(deps.backend.mutation).mockResolvedValue(undefined);
    const wsClient = makeMockWsClient();

    await runWithSession(startFileTreeSubscriptionEffect(wsClient as any), {
      sessionId: 'session-fulfill',
      machineId: 'machine-fulfill',
      backend: deps.backend,
    });

    const onUpdateCallback = vi.mocked(wsClient.onUpdate).mock.calls[0]?.[2] as (
      requests: { _id: string; workingDir: string }[]
    ) => void;

    onUpdateCallback([{ _id: 'req-1', workingDir: '/workspace' }]);

    await vi.waitFor(() => {
      expect(mockScanFileTree).toHaveBeenCalledWith('/workspace');
      expect(deps.backend.mutation).toHaveBeenCalled();
    });

    const mutationCalls = vi.mocked(deps.backend.mutation).mock.calls.map((call) => call[0]);
    expect(mutationCalls).toContain('mock-syncFileTreeV2');
    expect(mutationCalls).toContain('mock-fulfillFileTreeRequest');
  });
});
