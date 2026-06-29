import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { describe, expect, test } from 'vitest';

import { listNativeTasksNeedingRevive, NudgeCooldown } from './task-monitor-logic.js';

function makeNativeTask(overrides: Partial<AssignedTaskView> = {}): AssignedTaskView {
  return {
    taskId: 'task_1' as AssignedTaskView['taskId'],
    chatroomId: 'room_1' as AssignedTaskView['chatroomId'],
    status: 'pending',
    assignedTo: 'planner',
    taskContent: '',
    updatedAt: 1_000,
    createdAt: 1_000,
    agentConfig: {
      role: 'planner',
      machineId: 'machine_1',
      agentHarness: 'cursor-sdk',
      workingDir: '/tmp/project',
      spawnedAgentPid: 12345,
      desiredState: 'running',
    },
    participant: {
      lastSeenAction: 'native:waiting',
      lastSeenAt: 1_000,
      lastStatus: 'agent.waiting',
    },
    ...overrides,
  };
}

describe('listNativeTasksNeedingRevive', () => {
  test('revives when daemon slot is idle but backend still has PID', () => {
    const task = makeNativeTask();
    const cooldown = new NudgeCooldown(60_000);
    const now = 1_000_000;
    const ready = listNativeTasksNeedingRevive(
      [task],
      {
        getSlot: () => ({ state: 'idle' }),
        isPidAlive: () => true,
      },
      now,
      cooldown
    );
    expect(ready).toHaveLength(1);
  });

  test('revives when backend PID is not alive locally', () => {
    const task = makeNativeTask();
    const ready = listNativeTasksNeedingRevive(
      [task],
      {
        getSlot: () => ({ state: 'running', pid: 12345 }),
        isPidAlive: () => false,
      },
      1_000_000,
      new NudgeCooldown(60_000)
    );
    expect(ready).toHaveLength(1);
  });

  test('skips when slot PID matches and process is alive', () => {
    const task = makeNativeTask();
    const ready = listNativeTasksNeedingRevive(
      [task],
      {
        getSlot: () => ({ state: 'running', pid: 12345 }),
        isPidAlive: () => true,
      },
      1_000_000,
      new NudgeCooldown(60_000)
    );
    expect(ready).toHaveLength(0);
  });

  test('returns stale native tasks respecting cooldown', () => {
    const task = makeNativeTask();
    const cooldown = new NudgeCooldown(60_000);
    const now = 1_000_000;
    const ready = listNativeTasksNeedingRevive(
      [task],
      {
        getSlot: () => ({ state: 'idle' }),
        isPidAlive: () => false,
      },
      now,
      cooldown
    );
    expect(ready).toHaveLength(1);
    expect(cooldown.canNudge('room_1', 'planner', now + 1)).toBe(false);
  });

  test('revives acknowledged task when agent slot is idle after crash', () => {
    const task = makeNativeTask({
      status: 'acknowledged',
      agentConfig: {
        ...makeNativeTask().agentConfig,
        spawnedAgentPid: undefined,
      },
    });
    const ready = listNativeTasksNeedingRevive(
      [task],
      {
        getSlot: () => ({ state: 'idle' }),
        isPidAlive: () => false,
      },
      1_000_000,
      new NudgeCooldown(60_000)
    );
    expect(ready).toHaveLength(1);
  });

  test('skips revive while agent is spawning', () => {
    const task = makeNativeTask({
      agentConfig: {
        ...makeNativeTask().agentConfig,
        spawnedAgentPid: undefined,
      },
    });
    const ready = listNativeTasksNeedingRevive(
      [task],
      {
        getSlot: () => ({ state: 'spawning' }),
        isPidAlive: () => false,
      },
      1_000_000,
      new NudgeCooldown(60_000)
    );
    expect(ready).toHaveLength(0);
  });
});
