import { Effect, Layer } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import type { AgentRequestStopEventPayload } from './on-request-stop-agent.js';
import { onRequestStopAgentEffect } from './on-request-stop-agent.js';
import { DaemonAgentProcessManagerService } from '../../../commands/machine/daemon-start/daemon-services.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

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
      resumeTurnForSlot: vi.fn().mockReturnValue(Effect.succeed(undefined)),
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
      resumeTurnForSlot: vi.fn().mockReturnValue(Effect.succeed(undefined)),
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
