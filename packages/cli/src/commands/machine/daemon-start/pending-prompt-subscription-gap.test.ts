/**
 * Tests for the pending harness session daemon subscription (Phase B).
 *
 * These tests verify that the daemon correctly subscribes to `chatroom_harnessSessions`
 * rows with status='pending' and orchestrates the full open-session flow
 * (getOrSpawn → openSession → associateHarnessSessionId).
 *
 * This closes the gap documented in Phase A: webapp clicks were creating
 * pending rows that no daemon subscriber ever processed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { startPendingHarnessSessionSubscription } from './pending-harness-session-subscription.js';
import type { DaemonContext } from './types.js';
import type { HarnessProcessRegistry } from '../../../application/direct-harness/get-or-spawn-harness.js';

// ─── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('@workspace/backend/config/featureFlags.js', () => ({
  featureFlags: { directHarnessWorkers: true },
}));

vi.mock('../../../infrastructure/harnesses/opencode-sdk/chunk-extractor.js', () => ({
  openCodeChunkExtractor: vi.fn().mockReturnValue(null),
}));

vi.mock('../../../infrastructure/services/direct-harness/message-stream/index.js', () => ({
  BufferedMessageStreamSink: vi.fn().mockImplementation(() => ({ write: vi.fn() })),
  ConvexMessageStreamTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../../../application/direct-harness/internal.js', () => ({
  createDefaultFlushStrategy: vi.fn().mockReturnValue({}),
  wireEventSink: vi.fn().mockReturnValue(() => {}),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeMockContext(overrides?: Partial<DaemonContext['deps']['backend']>): DaemonContext {
  return {
    client: null,
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null,
    events: {} as DaemonContext['events'],
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
    observedSyncEnabled: false,
    deps: {
      backend: {
        mutation: vi.fn().mockResolvedValue(undefined),
        query: vi.fn().mockResolvedValue({ workingDir: '/test/workspace', _id: 'ws-1' }),
        ...overrides,
      },
    },
  } as unknown as DaemonContext;
}

function makeMockHarnessSession() {
  return {
    harnessSessionId: 'harness-session-abc',
    close: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn().mockReturnValue(() => {}),
  };
}

function makeMockHarnessProcess(session = makeMockHarnessSession()) {
  return {
    workspaceId: 'ws-1',
    listAgents: vi.fn().mockResolvedValue(['builder']),
    spawner: {
      openSession: vi.fn().mockResolvedValue(session),
    },
  };
}

function makeMockWsClient(callback?: (pendingSessions: unknown[]) => void): {
  wsClient: any;
  triggerUpdate: (sessions: unknown[]) => void;
} {
  let capturedCallback: ((sessions: unknown[]) => void) | null = null;
  const wsClient = {
    onUpdate: vi
      .fn()
      .mockImplementation((_query: unknown, _args: unknown, cb: (sessions: unknown[]) => void) => {
        capturedCallback = cb;
        return vi.fn(); // unsubscribe
      }),
  };

  return {
    wsClient,
    triggerUpdate: (sessions: unknown[]) => {
      if (capturedCallback) capturedCallback(sessions);
      if (callback) callback(sessions);
    },
  };
}

function makePendingSession(id = 'session-row-1', workspaceId = 'ws-1' as any) {
  return {
    _id: id,
    workspaceId,
    agent: 'builder',
    harnessName: 'opencode-sdk',
    status: 'pending',
    harnessSessionId: undefined,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('startPendingHarnessSessionSubscription', () => {
  let ctx: DaemonContext;
  let harnessProcess: ReturnType<typeof makeMockHarnessProcess>;
  let harnessRegistry: HarnessProcessRegistry;

  beforeEach(() => {
    vi.clearAllMocks();
    harnessProcess = makeMockHarnessProcess();
    harnessRegistry = {
      getOrSpawn: vi.fn().mockResolvedValue(harnessProcess),
      killAll: vi.fn().mockResolvedValue(undefined),
      setOnHarnessBooted: vi.fn(),
    } as unknown as HarnessProcessRegistry;
    ctx = makeMockContext();
  });

  it('subscribes to listPendingSessionsForMachine on the wsClient', () => {
    const { wsClient } = makeMockWsClient();
    startPendingHarnessSessionSubscription(ctx, wsClient, harnessRegistry);
    expect(wsClient.onUpdate).toHaveBeenCalledOnce();
    // Verify it subscribes with the correct session and machine IDs
    const [_query, args] = wsClient.onUpdate.mock.calls[0] as [
      unknown,
      { sessionId: string; machineId: string },
    ];
    expect(args.sessionId).toBe('test-session');
    expect(args.machineId).toBe('test-machine');
  });

  it('returns a stop() handle that calls unsubscribe', () => {
    const mockUnsubscribe = vi.fn();
    const wsClient = {
      onUpdate: vi.fn().mockReturnValue(mockUnsubscribe),
    };
    const handle = startPendingHarnessSessionSubscription(ctx, wsClient as any, harnessRegistry);
    handle.stop();
    expect(mockUnsubscribe).toHaveBeenCalledOnce();
  });

  it('does nothing when subscription fires with empty array', async () => {
    const { wsClient, triggerUpdate } = makeMockWsClient();
    startPendingHarnessSessionSubscription(ctx, wsClient, harnessRegistry);
    triggerUpdate([]);
    // Allow microtasks to flush
    await new Promise((r) => setTimeout(r, 10));
    expect(harnessRegistry.getOrSpawn).not.toHaveBeenCalled();
  });

  it('calls getOrSpawn for a pending session workspace', async () => {
    const { wsClient, triggerUpdate } = makeMockWsClient();
    startPendingHarnessSessionSubscription(ctx, wsClient, harnessRegistry);
    triggerUpdate([makePendingSession()]);
    await new Promise((r) => setTimeout(r, 50));
    expect(harnessRegistry.getOrSpawn).toHaveBeenCalledWith('ws-1', '/test/workspace');
  });

  it('calls spawner.openSession with the session agent', async () => {
    const { wsClient, triggerUpdate } = makeMockWsClient();
    startPendingHarnessSessionSubscription(ctx, wsClient, harnessRegistry);
    triggerUpdate([makePendingSession('row-1', 'ws-1' as any)]);
    await new Promise((r) => setTimeout(r, 50));
    expect(harnessProcess.spawner.openSession).toHaveBeenCalledWith({
      config: { agent: 'builder' },
    });
  });

  it('calls associateHarnessSessionId after spawner.openSession succeeds', async () => {
    const { wsClient, triggerUpdate } = makeMockWsClient();
    startPendingHarnessSessionSubscription(ctx, wsClient, harnessRegistry);
    triggerUpdate([makePendingSession('row-1', 'ws-1' as any)]);
    await new Promise((r) => setTimeout(r, 50));

    const mutationMock = ctx.deps.backend.mutation as ReturnType<typeof vi.fn>;
    // associateHarnessSessionId should have been called (the second mutation call —
    // the first arg is the Convex API reference object, so we just verify it was called)
    expect(mutationMock).toHaveBeenCalled();
    // Verify the harnessSessionId passed matches the mock harness session
    const calls = mutationMock.mock.calls as unknown[][];
    const assocCall = calls.find((call) => {
      const args = call[1] as Record<string, unknown> | undefined;
      return args && 'harnessSessionId' in args;
    });
    expect(assocCall).toBeDefined();
    expect((assocCall![1] as Record<string, unknown>).harnessSessionId).toBe('harness-session-abc');
  });

  it('does not process the same session row twice (in-flight dedup)', async () => {
    // Make getOrSpawn slow so the first call is still in-flight when the subscription fires again
    let resolveFirst!: () => void;
    const firstSpawnPromise = new Promise<void>((r) => {
      resolveFirst = r;
    });
    (harnessRegistry.getOrSpawn as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      firstSpawnPromise.then(() => harnessProcess)
    );

    const { wsClient, triggerUpdate } = makeMockWsClient();
    startPendingHarnessSessionSubscription(ctx, wsClient, harnessRegistry);

    const session = makePendingSession('row-1', 'ws-1' as any);
    triggerUpdate([session]);
    triggerUpdate([session]); // fire again while first is in-flight

    resolveFirst();
    await new Promise((r) => setTimeout(r, 50));

    // getOrSpawn should only have been called once despite two subscription fires
    expect(harnessRegistry.getOrSpawn).toHaveBeenCalledOnce();
  });

  it('closes the session row when workspace is not found', async () => {
    (ctx.deps.backend.query as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const mutationMock = ctx.deps.backend.mutation as ReturnType<typeof vi.fn>;

    const { wsClient, triggerUpdate } = makeMockWsClient();
    startPendingHarnessSessionSubscription(ctx, wsClient, harnessRegistry);
    triggerUpdate([makePendingSession('row-missing-ws', 'ws-missing' as any)]);
    await new Promise((r) => setTimeout(r, 50));

    expect(harnessRegistry.getOrSpawn).not.toHaveBeenCalled();
    // closeSession mutation should have been called
    expect(mutationMock).toHaveBeenCalled();
  });

  it('closes the harness session if associateHarnessSessionId throws', async () => {
    const harnessSession = makeMockHarnessSession();
    harnessProcess = makeMockHarnessProcess(harnessSession);
    (harnessRegistry.getOrSpawn as ReturnType<typeof vi.fn>).mockResolvedValue(harnessProcess);

    // Make associateHarnessSessionId throw
    (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('conflict')
    );

    const { wsClient, triggerUpdate } = makeMockWsClient();
    startPendingHarnessSessionSubscription(ctx, wsClient, harnessRegistry);
    triggerUpdate([makePendingSession('row-1', 'ws-1' as any)]);
    await new Promise((r) => setTimeout(r, 50));

    expect(harnessSession.close).toHaveBeenCalled();
  });
});
