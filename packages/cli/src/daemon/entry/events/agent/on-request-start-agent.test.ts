import { Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import type { AgentRequestStartEventPayload } from './on-request-start-agent.js';
import { onRequestStartAgentEffect } from './on-request-start-agent.js';
import type { AgentLifecycleFact } from '../../../domain/entities/agent-lifecycle-fact.js';
import type { AgentLifecycleOutboxResult } from '../../../infrastructure/outbox/agent-lifecycle-outbox.js';
import type { AgentProcessManagerService } from '../../../services/agent-process-service/index.js';
import {
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
} from '../../daemon-services.js';
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
  function makeSessionLayer(
    backendMutation = vi.fn().mockResolvedValue(undefined),
    lifecycleEnqueue?: ReturnType<typeof vi.fn>
  ) {
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
      taskService: {} as never,
      agentConfigRegistry: { get: () => undefined } as never,
      ...(lifecycleEnqueue
        ? {
            lifecycleOutbox: {
              enqueue: lifecycleEnqueue.mockResolvedValue({ success: true }) as unknown as (
                fact: AgentLifecycleFact
              ) => Promise<AgentLifecycleOutboxResult>,
            },
          }
        : {}),
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

  test('enqueues an agent status fact when startAgent fails', async () => {
    const startSpy = vi.fn().mockRejectedValue(new Error('rate_limited'));
    const apmLayer = makeCommandLayer(startSpy);
    const backendMutation = vi.fn().mockResolvedValue(undefined);
    const lifecycleEnqueue = vi.fn();
    const sessionLayer = makeSessionLayer(backendMutation, lifecycleEnqueue);
    const event = createEvent();

    await runEffect(event, apmLayer, sessionLayer);

    expect(lifecycleEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'status',
        chatroomId: event.chatroomId,
        role: event.role,
        status: 'error',
        errorSource: 'configuration',
        errorCode: 'agent.startFailed',
        errorMessage: 'rate_limited',
      })
    );
    expect(backendMutation).not.toHaveBeenCalled();
  });
});
