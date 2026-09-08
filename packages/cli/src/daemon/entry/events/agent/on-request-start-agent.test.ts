import { Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import type { AgentRequestStartEventPayload } from './on-request-start-agent.js';
import { onRequestStartAgentEffect } from './on-request-start-agent.js';
import {
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
} from '../../daemon-services.js';
import type { AgentProcessManagerService } from '../../../services/agent-process-service/index.js';
import { DaemonEventBus } from '../event-bus.js';

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
      logEvent: async () => undefined,
    });
  }

  function runEffect(
    event: AgentRequestStartEventPayload,
    apmLayer: Layer.Layer<DaemonAgentProcessManagerCommandService>,
    sessionLayer: Layer.Layer<DaemonSessionService>
  ) {
    return Effect.runPromise(
      onRequestStartAgentEffect(event).pipe(Effect.provide(Layer.merge(apmLayer, sessionLayer)))
    );
  }

  function makeCommandLayer(startAgent: ReturnType<typeof vi.fn>) {
    return Layer.succeed(DaemonAgentProcessManagerCommandService, {
      startAgent,
    } as unknown as AgentProcessManagerService);
  }

  test('skips expired events without calling startAgent', async () => {
    const startSpy = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const apmLayer = makeCommandLayer(startSpy);
    const sessionLayer = makeSessionLayer();
    const event = createEvent({ deadline: Date.now() - 1000 });

    await runEffect(event, apmLayer, sessionLayer);

    expect(startSpy).not.toHaveBeenCalled();
  });

  test('calls startAgent for valid (non-expired) events', async () => {
    const startSpy = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const apmLayer = makeCommandLayer(startSpy);
    const sessionLayer = makeSessionLayer();
    const event = createEvent();

    await runEffect(event, apmLayer, sessionLayer);

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: event.chatroomId,
        role: event.role,
        wantResume: true,
      })
    );
  });

  test('calls emitAgentStartFailed mutation when startAgent fails', async () => {
    const startSpy = vi.fn().mockRejectedValue(new Error('rate_limited'));
    const apmLayer = makeCommandLayer(startSpy);
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
