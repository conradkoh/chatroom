import { GET_NEXT_TASK_STARTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { describe, expect, test } from 'vitest';

import { isCliIdleNotListening, isStaleCliGetNextTaskWaiting } from './predicates.js';

function makeTask(overrides: Partial<AssignedTaskView> = {}): AssignedTaskView {
  return {
    taskId: 'task_1' as AssignedTaskView['taskId'],
    chatroomId: 'room_1' as AssignedTaskView['chatroomId'],
    status: 'pending',
    assignedTo: 'builder',
    taskContent: '',
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
      lastSeenAction: 'native:waiting',
      lastSeenAt: 500,
      lastStatus: 'agent.waiting',
    },
    ...overrides,
  };
}

describe('isStaleCliGetNextTaskWaiting', () => {
  test('true when task created after last get-next-task heartbeat', () => {
    const task = makeTask({
      agentConfig: { ...makeTask().agentConfig, agentHarness: 'opencode' },
      createdAt: 2_000,
      participant: {
        lastSeenAction: GET_NEXT_TASK_STARTED_ACTION,
        lastSeenAt: 1_000,
        lastStatus: 'agent.waiting',
      },
    });
    expect(isStaleCliGetNextTaskWaiting(task)).toBe(true);
  });
});

describe('isCliIdleNotListening', () => {
  test('true when never seen and task is old', () => {
    const task = makeTask({
      agentConfig: { ...makeTask().agentConfig, agentHarness: 'opencode' },
      createdAt: 1_000,
      participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
    });
    expect(isCliIdleNotListening(task, 20_000, 15_000)).toBe(true);
  });
});
