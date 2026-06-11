import { Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import type { AgentRequestStartEventPayload } from './on-request-start-agent.js';
import { onRequestStartAgent, onRequestStartAgentEffect } from './on-request-start-agent.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../../commands/machine/daemon-start/daemon-services.js';
import type { DaemonContext } from '../../../commands/machine/daemon-start/types.js';
import { DaemonEventBus } from '../../../events/daemon/event-bus.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockCtx(overrides?: {
  ensureRunningResult?: { success: boolean; pid?: number; error?: string };
}): DaemonContext {
  const ensureRunningResult = overrides?.ensureRunningResult ?? { success: true, pid: 42 };
  return {
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: {
      hostname: 'test-host',
      machineId: 'test-machine',
      availableHarnesses: ['opencode'] as any[],
      harnessVersions: {},
    },
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
    deps: {
      agentProcessManager: {
        ensureRunning: vi.fn().mockResolvedValue(ensureRunningResult),
        stop: vi.fn().mockResolvedValue({ success: true }),
        handleExit: vi.fn(),
        getSlot: vi.fn(),
        listActive: vi.fn().mockReturnValue([]),
        recover: vi.fn().mockResolvedValue(undefined),
      },
      backend: {
        query: vi.fn().mockResolvedValue(undefined),
        mutation: vi.fn().mockResolvedValue(undefined),
      },
    },
  } as unknown as DaemonContext;
}

function createEvent(
  overrides?: Partial<AgentRequestStartEventPayload>
): AgentRequestStartEventPayload {
  return {
    _id: 'test-event-id' as any,
    chatroomId: 'test-chatroom' as any,
    role: 'builder',
    agentHarness: 'opencode' as any,
    model: 'gpt-4',
    workingDir: '/test/dir',
    reason: 'user.start',
    deadline: Date.now() + 60_000, // 60s from now
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('onRequestStartAgent', () => {
  test('skips expired events', async () => {
    const ctx = createMockCtx();
    const event = createEvent({ deadline: Date.now() - 1000 }); // already expired

    await onRequestStartAgent(ctx, event);

    expect(ctx.deps.agentProcessManager.ensureRunning).not.toHaveBeenCalled();
  });

  test('calls ensureRunning for valid events', async () => {
    const ctx = createMockCtx();
    const event = createEvent();

    await onRequestStartAgent(ctx, event);

    expect(ctx.deps.agentProcessManager.ensureRunning).toHaveBeenCalledWith({
      chatroomId: event.chatroomId,
      role: event.role,
      agentHarness: event.agentHarness,
      model: event.model,
      workingDir: event.workingDir,
      reason: event.reason,
      wantResume: true,
    });
  });

  test('passes wantResume=false when event specifies it', async () => {
    const ctx = createMockCtx();
    const event = createEvent({ wantResume: false });

    await onRequestStartAgent(ctx, event);

    expect(ctx.deps.agentProcessManager.ensureRunning).toHaveBeenCalledWith(
      expect.objectContaining({ wantResume: false })
    );
  });

  test('emits startFailed when ensureRunning fails', async () => {
    const ctx = createMockCtx({
      ensureRunningResult: { success: false, error: 'rate_limited' },
    });
    const event = createEvent();

    await onRequestStartAgent(ctx, event);

    // Verify emitAgentStartFailed was called
    expect(ctx.deps.backend.mutation).toHaveBeenCalledWith(
      expect.anything(), // api.machines.emitAgentStartFailed
      expect.objectContaining({
        sessionId: 'test-session',
        machineId: 'test-machine',
        chatroomId: event.chatroomId,
        role: event.role,
        error: 'rate_limited',
      })
    );
  });

  test('does not emit startFailed when ensureRunning succeeds', async () => {
    const ctx = createMockCtx({
      ensureRunningResult: { success: true, pid: 42 },
    });
    const event = createEvent();

    await onRequestStartAgent(ctx, event);

    // backend.mutation should be called for workspace registration, not startFailed
    const calls = (ctx.deps.backend.mutation as ReturnType<typeof vi.fn>).mock.calls;
    // Filter for calls that look like emitAgentStartFailed (contain 'error' field)
    const startFailedCalls = calls.filter(
      (call: unknown[]) =>
        call.length >= 2 && (call[1] as Record<string, unknown>)?.error !== undefined
    );
    expect(startFailedCalls).toHaveLength(0);
  });
});

// ─── Effect twin tests ───────────────────────────────────────────────────────

describe('onRequestStartAgentEffect', () => {
  function makeSessionLayer(backendMutation = vi.fn().mockResolvedValue(undefined)) {
    return Layer.succeed(DaemonSessionService, {
      sessionId: 'test-session',
      machineId: 'test-machine',
      client: {} as any,
      config: { hostname: 'test-host' } as any,
      backend: { mutation: backendMutation, query: vi.fn().mockResolvedValue(undefined) } as any,
      fs: { stat: vi.fn() } as any,
      agentServices: new Map(),
      events: new DaemonEventBus(),
      lastPushedGitState: new Map(),
      lastPushedModels: null,
      lastPushedHarnessFingerprint: null,
    });
  }

  function runEffect(
    event: AgentRequestStartEventPayload,
    apmLayer: Layer.Layer<DaemonAgentProcessManagerService>,
    sessionLayer: Layer.Layer<DaemonSessionService>
  ) {
    return Effect.runPromise(
      onRequestStartAgentEffect(event).pipe(Effect.provide(Layer.merge(apmLayer, sessionLayer)))
    );
  }

  test('skips expired events without calling ensureRunning', async () => {
    const ensureSpy = vi.fn().mockReturnValue(Effect.succeed({ success: true }));
    const apmLayer = Layer.succeed(DaemonAgentProcessManagerService, {
      ensureRunning: ensureSpy,
      stop: vi.fn().mockReturnValue(Effect.succeed({ success: true })),
      handleExit: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      recover: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      getSlot: vi.fn().mockReturnValue(undefined),
      listActive: vi.fn().mockReturnValue([]),
      whenTurnEndsIdle: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    });
    const sessionLayer = makeSessionLayer();
    const event = createEvent({ deadline: Date.now() - 1000 });

    await runEffect(event, apmLayer, sessionLayer);

    expect(ensureSpy).not.toHaveBeenCalled();
  });

  test('calls ensureRunning for valid (non-expired) events', async () => {
    const ensureSpy = vi.fn().mockReturnValue(Effect.succeed({ success: true, pid: 42 }));
    const apmLayer = Layer.succeed(DaemonAgentProcessManagerService, {
      ensureRunning: ensureSpy,
      stop: vi.fn().mockReturnValue(Effect.succeed({ success: true })),
      handleExit: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      recover: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      getSlot: vi.fn().mockReturnValue(undefined),
      listActive: vi.fn().mockReturnValue([]),
      whenTurnEndsIdle: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    });
    const sessionLayer = makeSessionLayer();
    const event = createEvent();

    await runEffect(event, apmLayer, sessionLayer);

    expect(ensureSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: event.chatroomId,
        role: event.role,
        wantResume: true,
      })
    );
  });

  test('calls emitAgentStartFailed mutation when ensureRunning fails', async () => {
    const ensureSpy = vi
      .fn()
      .mockReturnValue(Effect.succeed({ success: false, error: 'rate_limited' }));
    const apmLayer = Layer.succeed(DaemonAgentProcessManagerService, {
      ensureRunning: ensureSpy,
      stop: vi.fn().mockReturnValue(Effect.succeed({ success: true })),
      handleExit: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      recover: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      getSlot: vi.fn().mockReturnValue(undefined),
      listActive: vi.fn().mockReturnValue([]),
      whenTurnEndsIdle: vi.fn().mockReturnValue(Effect.succeed(undefined)),
    });
    const backendMutation = vi.fn().mockResolvedValue(undefined);
    const sessionLayer = makeSessionLayer(backendMutation);
    const event = createEvent();

    await runEffect(event, apmLayer, sessionLayer);

    expect(backendMutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'test-session',
        machineId: 'test-machine',
        chatroomId: event.chatroomId,
        role: event.role,
        error: 'rate_limited',
      })
    );
  });
});
