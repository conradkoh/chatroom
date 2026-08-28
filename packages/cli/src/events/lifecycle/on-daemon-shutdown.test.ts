import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { onDaemonShutdownEffect } from './on-daemon-shutdown.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
} from '../../daemon/entry/daemon-services.js';

vi.mock('../../daemon/entry/handlers/command-runner.js', () => ({
  shutdownAllCommandsEffect: Effect.succeed(undefined),
}));

function runShutdown({
  activeAgents,
}: {
  activeAgents: { chatroomId: string; role: string }[];
}) {
  const stop = vi.fn(() => Effect.succeed({ success: true }));
  const agentPm = {
    listActive: () => activeAgents,
    whenTurnEndsIdle: () => Effect.succeed(undefined),
    stop,
  };
  const session = {
    sessionId: 'session',
    machineId: 'machine',
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
    },
  };
  return Effect.runPromise(
    onDaemonShutdownEffect.pipe(
      Effect.provide(
        Layer.merge(
          Layer.succeed(DaemonAgentProcessManagerService, agentPm as never),
          Layer.succeed(DaemonSessionService, session as never)
        )
      )
    )
  );
}

describe('onDaemonShutdownEffect', () => {
  afterEach(() => vi.restoreAllMocks());

  test('logs stopped and failed counts', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runShutdown({
      activeAgents: [{ chatroomId: 'room-a', role: 'planner' }, { chatroomId: 'room-b', role: 'builder' }],
    });
    expect(log.mock.calls.flat().join(' ')).toContain('Shutdown stops: 2 stopped');
    expect(log.mock.calls.flat().join(' ')).not.toContain('All agents stopped');
  });

  test('logs stopped count when all succeed', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runShutdown({
      activeAgents: [{ chatroomId: 'room', role: 'planner' }],
    });
    expect(log.mock.calls.flat().join(' ')).toContain('Shutdown stops: 1 stopped');
  });

  test('does not log a stop summary with no active agents', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runShutdown({ activeAgents: [] });
    expect(log.mock.calls.flat().join(' ')).not.toContain('Shutdown stops:');
  });
});
