import { Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import type { AgentRequestStartEventPayload } from './on-request-start-agent.js';
import { onRequestStartAgentEffect } from './on-request-start-agent.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../../commands/machine/daemon-start/daemon-services.js';
import { DaemonEventBus } from '../../../events/daemon/event-bus.js';

// ─── Helper ──────────────────────────────────────────────────────────────────

function createEvent(
  overrides?: Partial<AgentRequestStartEventPayload>
): AgentRequestStartEventPayload {
  return {
    _id: 'test-id-123' as any,
    chatroomId: 'test-chatroom' as any,
    role: 'builder',
    agentHarness: 'opencode',
    model: 'gpt-4',
    workingDir: '/tmp/test',
    reason: 'user.start',
    deadline: Date.now() + 60_000,
    wantResume: true,
    ...overrides,
  };
}

// ─── Effect twin tests ───────────────────────────────────────────────────────

describe('onRequestStartAgentEffect', () => {
  function makeSessionLayer(backendMutation = vi.fn().mockResolvedValue(undefined)) {
    return Layer.succeed(DaemonSessionService, {
      sessionId: 'test-session',
      machineId: 'test-machine',
      convexUrl: 'http://test:3210',
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
      resumeTurnForSlot: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
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
      resumeTurnForSlot: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
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
      resumeTurnForSlot: vi.fn().mockReturnValue(Effect.succeed(undefined)),
      setLastInFlightTask: vi.fn().mockReturnValue(Effect.void),
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
