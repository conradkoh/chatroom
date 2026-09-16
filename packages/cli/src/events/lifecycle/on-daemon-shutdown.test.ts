import { Effect, Layer } from 'effect';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { onDaemonShutdownEffect } from './on-daemon-shutdown.js';
import {
  DaemonAgentProcessManagerCommandService,
  DaemonSessionService,
} from '../../daemon/entry/daemon-services.js';
import type { AgentProcessManagerService } from '../../daemon/services/agent-process-service/index.js';

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
    taskService: {
      listTasksForRole: vi.fn().mockReturnValue([]),
      releaseTaskAfterTurnFailure: vi.fn().mockResolvedValue({ released: true }),
    },
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

  test('releases in-flight tasks for active roles before stopping agents', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const releaseTaskAfterTurnFailure = vi.fn().mockResolvedValue({ released: true });
    const stopAgent = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const session = {
      sessionId: 'session',
      machineId: 'machine',
      taskService: {
        listTasksForRole: vi.fn().mockImplementation((_chatroomId: string, role: string) =>
          role === 'planner'
            ? [
                { taskId: 'task-1', status: 'in_progress' },
                { taskId: 'task-2', status: 'completed' },
                { taskId: 'task-3', status: 'acknowledged' },
              ]
            : []
        ),
        releaseTaskAfterTurnFailure,
      },
      backend: { mutation: vi.fn().mockResolvedValue(undefined) },
    };
    const agentPm = {
      listActive: () => [{ chatroomId: 'room', role: 'planner' }],
      whenTurnEndsIdle: async () => undefined,
      stopAgent,
    };
    await Effect.runPromise(
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
    // Only acknowledged/in_progress tasks are released; completed tasks are skipped.
    expect(releaseTaskAfterTurnFailure.mock.calls).toEqual([
      [{ chatroomId: 'room', role: 'planner', taskId: 'task-1' }],
      [{ chatroomId: 'room', role: 'planner', taskId: 'task-3' }],
    ]);
    // Releases happen before the agents are stopped.
    expect(releaseTaskAfterTurnFailure.mock.invocationCallOrder[0]).toBeLessThan(
      stopAgent.mock.invocationCallOrder[0]
    );
    expect(log.mock.calls.flat().join(' ')).toContain('Released 2 in-flight task(s) to pending');
  });

  test('continues stopping agents when in-flight release fails', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const stopAgent = vi.fn().mockResolvedValue({ status: 'succeeded' });
    const session = {
      sessionId: 'session',
      machineId: 'machine',
      taskService: {
        listTasksForRole: vi.fn().mockReturnValue([{ taskId: 'task-1', status: 'in_progress' }]),
        releaseTaskAfterTurnFailure: vi.fn().mockRejectedValue(new Error('backend down')),
      },
      backend: { mutation: vi.fn().mockResolvedValue(undefined) },
    };
    const agentPm = {
      listActive: () => [{ chatroomId: 'room', role: 'planner' }],
      whenTurnEndsIdle: async () => undefined,
      stopAgent,
    };
    await Effect.runPromise(
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
    expect(stopAgent).toHaveBeenCalled();
    expect(log.mock.calls.flat().join(' ')).toContain(
      'Failed to release in-flight tasks for planner@room'
    );
  });
});
