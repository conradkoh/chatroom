import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';
import { describe, expect, test } from 'vitest';

import { NudgeCooldown, shouldNudgePendingTask } from './task-monitor-logic.js';

function makeTask(overrides: Partial<AssignedTaskView> = {}): AssignedTaskView {
  return {
    taskId: 'task_1' as AssignedTaskView['taskId'],
    chatroomId: 'room_1' as AssignedTaskView['chatroomId'],
    status: 'pending',
    assignedTo: 'builder',
    updatedAt: 1_000,
    createdAt: 1_000,
    agentConfig: {
      role: 'builder',
      machineId: 'machine_1',
      agentHarness: 'cursor-sdk',
      workingDir: '/tmp/project',
      spawnedAgentPid: 12345,
      desiredState: 'running',
    },
    participant: {
      lastSeenAction: 'get-next-task:started',
      lastSeenAt: 500,
      lastStatus: 'agent.waiting',
    },
    ...overrides,
  };
}

describe('shouldNudgePendingTask', () => {
  test('nudges when agent claims listening but task arrived after lastSeenAt', () => {
    const now = 10_000;
    expect(shouldNudgePendingTask(makeTask(), now)).toBe(true);
  });

  test('does not nudge when task predates lastSeenAt', () => {
    const now = 10_000;
    expect(
      shouldNudgePendingTask(
        makeTask({
          createdAt: 400,
          participant: {
            lastSeenAction: 'get-next-task:started',
            lastSeenAt: 500,
            lastStatus: 'agent.waiting',
          },
        }),
        now
      )
    ).toBe(false);
  });

  test('nudges when agent is idle after delivery and task is pending >15s', () => {
    const createdAt = 1_000;
    const now = createdAt + 15_000 + 1;
    expect(
      shouldNudgePendingTask(
        makeTask({
          createdAt,
          participant: {
            lastSeenAction: 'get-next-task:stopped',
            lastSeenAt: createdAt - 100,
            lastStatus: 'task.acknowledged',
          },
        }),
        now
      )
    ).toBe(true);
  });

  test('does not nudge non-pending tasks', () => {
    expect(shouldNudgePendingTask(makeTask({ status: 'in_progress' }), 10_000)).toBe(false);
  });

  test('does not nudge when agent process is not alive', () => {
    expect(
      shouldNudgePendingTask(
        makeTask({
          agentConfig: {
            ...makeTask().agentConfig,
            spawnedAgentPid: undefined,
          },
        }),
        10_000
      )
    ).toBe(false);
  });
});

describe('NudgeCooldown', () => {
  test('deduplicates nudges within cooldown window', () => {
    const cooldown = new NudgeCooldown(60_000);
    const now = 1_000_000;

    expect(cooldown.canNudge('room', 'builder', now)).toBe(true);
    cooldown.recordNudge('room', 'builder', now);
    expect(cooldown.canNudge('room', 'builder', now + 30_000)).toBe(false);
    expect(cooldown.canNudge('room', 'builder', now + 60_000)).toBe(true);
  });
});
