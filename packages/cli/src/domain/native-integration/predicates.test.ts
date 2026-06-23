import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';
import { describe, expect, test } from 'vitest';

import {
  isCliIdleNotListening,
  isInjectableNativeAction,
  isNativePendingAliveRunning,
  isStaleCliGetNextTaskWaiting,
  isStaleNativeWaiting,
  isStuckAfterNativeInject,
} from './predicates.js';

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
      lastSeenAction: NATIVE_WAITING_ACTION,
      lastSeenAt: 500,
      lastStatus: 'agent.waiting',
    },
    ...overrides,
  };
}

describe('isNativePendingAliveRunning', () => {
  test('true for live native pending task', () => {
    expect(isNativePendingAliveRunning(makeTask())).toBe(true);
  });

  test('false without pid', () => {
    expect(
      isNativePendingAliveRunning(
        makeTask({ agentConfig: { ...makeTask().agentConfig, spawnedAgentPid: undefined } })
      )
    ).toBe(false);
  });
});

describe('isInjectableNativeAction', () => {
  test('null and native:waiting are injectable', () => {
    expect(isInjectableNativeAction(null)).toBe(true);
    expect(isInjectableNativeAction(NATIVE_WAITING_ACTION)).toBe(true);
  });

  test('get-next-task:started is not injectable', () => {
    expect(isInjectableNativeAction('get-next-task:started')).toBe(false);
  });
});

describe('isStaleNativeWaiting', () => {
  test('true when waiting longer than threshold', () => {
    expect(isStaleNativeWaiting(makeTask({ createdAt: 1_000 }), 16_001, 15_000)).toBe(true);
  });
});

describe('isStuckAfterNativeInject', () => {
  test('true when injected task acknowledged but stale', () => {
    const task = makeTask({
      participant: {
        lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
        lastSeenAt: 1_000,
        lastStatus: 'task.acknowledged',
      },
    });
    expect(isStuckAfterNativeInject(task, 16_001, 15_000)).toBe(true);
  });

  test('true when task completed but native:waiting was never emitted', () => {
    const task = makeTask({
      participant: {
        lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
        lastSeenAt: 1_000,
        lastStatus: 'task.completed',
      },
    });
    expect(isStuckAfterNativeInject(task, 16_001, 15_000)).toBe(true);
  });
});

describe('isStaleCliGetNextTaskWaiting', () => {
  test('true when task created after last get-next-task heartbeat', () => {
    const task = makeTask({
      agentConfig: { ...makeTask().agentConfig, agentHarness: 'opencode' },
      createdAt: 2_000,
      participant: {
        lastSeenAction: 'get-next-task:started',
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
