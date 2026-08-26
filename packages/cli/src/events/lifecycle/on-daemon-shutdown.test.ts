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
  summaries,
  activeAgents,
}: {
  summaries: Record<string, { stoppedCount: number; failedCount: number }>;
  activeAgents: { chatroomId: string }[];
}) {
  const executeScopedStopForCommand = vi.fn((args: { chatroomId: string }) =>
    Effect.succeed(summaries[args.chatroomId] ?? { stoppedCount: 0, failedCount: 0 })
  );
  const agentPm = {
    listActive: () => activeAgents,
    whenTurnEndsIdle: () => Effect.succeed(undefined),
    executeScopedStopForCommand,
  };
  const session = {
    sessionId: 'session',
    machineId: 'machine',
    backend: {
      mutation: vi.fn().mockResolvedValue({ stopCommandId: 'stop', inboxCommandId: 'inbox' }),
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
      activeAgents: [{ chatroomId: 'room-a' }, { chatroomId: 'room-b' }],
      summaries: {
        'room-a': { stoppedCount: 2, failedCount: 0 },
        'room-b': { stoppedCount: 1, failedCount: 2 },
      },
    });
    expect(log.mock.calls.flat().join(' ')).toContain('Shutdown stops: 3 stopped, 2 failed');
    expect(log.mock.calls.flat().join(' ')).not.toContain('All agents stopped');
  });

  test('logs stopped count when all succeed', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runShutdown({
      activeAgents: [{ chatroomId: 'room' }],
      summaries: { room: { stoppedCount: 2, failedCount: 0 } },
    });
    expect(log.mock.calls.flat().join(' ')).toContain('Shutdown stops: 2 stopped');
  });

  test('does not log a stop summary with no active agents', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runShutdown({ activeAgents: [], summaries: {} });
    expect(log.mock.calls.flat().join(' ')).not.toContain('Shutdown stops:');
  });
});
