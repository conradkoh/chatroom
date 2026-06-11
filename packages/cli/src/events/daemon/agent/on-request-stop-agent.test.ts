import { Effect, Layer } from 'effect';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import type { AgentRequestStopEventPayload } from './on-request-stop-agent.js';
import { onRequestStopAgent, onRequestStopAgentEffect } from './on-request-stop-agent.js';
import { DaemonAgentProcessManagerService } from '../../../commands/machine/daemon-start/daemon-services.js';
import type { DaemonContext } from '../../../commands/machine/daemon-start/types.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createMockCtx(overrides?: { stopResult?: { success: boolean } }): DaemonContext {
  return {
    sessionId: 'test-session',
    machineId: 'test-machine',
    config: null,
    agentServices: new Map(),
    lastPushedGitState: new Map(),
    lastPushedModels: null,
    lastPushedHarnessFingerprint: null,
    deps: {
      agentProcessManager: {
        stop: vi.fn().mockResolvedValue(overrides?.stopResult ?? { success: true }),
        ensureRunning: vi.fn(),
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
  overrides?: Partial<AgentRequestStopEventPayload>
): AgentRequestStopEventPayload {
  return {
    chatroomId: 'test-chatroom' as any,
    role: 'builder',
    reason: 'user.stop',
    deadline: Date.now() + 60_000,
    ...overrides,
  };
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Legacy tests (onRequestStopAgent) ──────────────────────────────────────

describe('onRequestStopAgent', () => {
  test('skips expired events', async () => {
    const ctx = createMockCtx();
    const event = createEvent({ deadline: Date.now() - 1000 });

    await onRequestStopAgent(ctx, event);

    expect(ctx.deps.agentProcessManager.stop).not.toHaveBeenCalled();
  });

  test('calls stop for valid events', async () => {
    const ctx = createMockCtx();
    const event = createEvent();

    await onRequestStopAgent(ctx, event);

    expect(ctx.deps.agentProcessManager.stop).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: event.chatroomId,
        role: event.role,
        reason: event.reason,
      })
    );
  });
});

// ─── Effect twin tests (onRequestStopAgentEffect) ───────────────────────────

describe('onRequestStopAgentEffect', () => {
  test('skips expired events without calling stop', async () => {
    const stopSpy = vi.fn().mockReturnValue(Effect.succeed({ success: true }));
    const apmLayer = Layer.succeed(DaemonAgentProcessManagerService, {
      stop: stopSpy,
      ensureRunning: vi.fn(),
      handleExit: vi.fn(),
      recover: vi.fn(),
      getSlot: vi.fn(),
      listActive: vi.fn().mockReturnValue([]),
      whenTurnEndsIdle: vi.fn(),
    });
    const event = createEvent({ deadline: Date.now() - 1000 });

    await Effect.runPromise(onRequestStopAgentEffect(event).pipe(Effect.provide(apmLayer)));

    expect(stopSpy).not.toHaveBeenCalled();
  });

  test('calls executeStopAgentEffect for valid events', async () => {
    const stopSpy = vi.fn().mockReturnValue(Effect.succeed({ success: true }));
    const apmLayer = Layer.succeed(DaemonAgentProcessManagerService, {
      stop: stopSpy,
      ensureRunning: vi.fn(),
      handleExit: vi.fn(),
      recover: vi.fn(),
      getSlot: vi.fn(),
      listActive: vi.fn().mockReturnValue([]),
      whenTurnEndsIdle: vi.fn(),
    });
    const event = createEvent();

    await Effect.runPromise(onRequestStopAgentEffect(event).pipe(Effect.provide(apmLayer)));

    expect(stopSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: event.chatroomId,
        role: event.role,
        reason: event.reason,
      })
    );
  });
});
