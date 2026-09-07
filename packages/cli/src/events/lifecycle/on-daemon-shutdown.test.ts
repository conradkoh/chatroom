import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { onDaemonShutdownEffect } from './on-daemon-shutdown.js';
import {
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
} from '../../daemon/entry/daemon-services.js';
import type { AgentProcessManagerService } from '../../daemon/infrastructure/agent-process-manager/service/index.js';

vi.mock('../../daemon/entry/handlers/command-runner.js', () => ({
  shutdownAllCommandsEffect: Effect.succeed(undefined),
}));

function runShutdown({ activeAgents }: { activeAgents: { chatroomId: string; role: string }[] }) {
  const stopAgent = vi.fn().mockResolvedValue({ status: 'succeeded' });
  const agentPm = {
    listActive: () => activeAgents,
    whenTurnEndsIdle: async () => undefined,
    stopAgent,
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
          Layer.succeed(
            DaemonAgentProcessManagerCommandService,
            agentPm as unknown as AgentProcessManagerService
          ),
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
      activeAgents: [
        { chatroomId: 'room-a', role: 'planner' },
        { chatroomId: 'room-b', role: 'builder' },
      ],
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
