import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { describe, expect, test } from 'vitest';

import {
  isCliIdleNotListening,
  isInjectableNativeAction,
  isNativeInjectableAliveRunning,
  isStaleCliGetNextTaskWaiting,
  shouldEmitNativeWaitingOnTurnEnd,
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

describe('isNativeInjectableAliveRunning', () => {
  test('true for pending and acknowledged tasks owned by role', () => {
    expect(isNativeInjectableAliveRunning(makeTask())).toBe(true);
    expect(
      isNativeInjectableAliveRunning(makeTask({ status: 'acknowledged', assignedTo: 'builder' }))
    ).toBe(true);
  });

  test('false when acknowledged for a different role', () => {
    expect(
      isNativeInjectableAliveRunning(makeTask({ status: 'acknowledged', assignedTo: 'planner' }))
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

describe('shouldEmitNativeWaitingOnTurnEnd', () => {
  test('false while task is acknowledged or in progress', () => {
    expect(shouldEmitNativeWaitingOnTurnEnd('task.acknowledged')).toBe(false);
    expect(shouldEmitNativeWaitingOnTurnEnd('task.inProgress')).toBe(false);
  });

  test('true when idle, waiting, or task completed', () => {
    expect(shouldEmitNativeWaitingOnTurnEnd('agent.waiting')).toBe(true);
    expect(shouldEmitNativeWaitingOnTurnEnd('task.completed')).toBe(true);
    expect(shouldEmitNativeWaitingOnTurnEnd(null)).toBe(true);
    expect(shouldEmitNativeWaitingOnTurnEnd(undefined)).toBe(true);
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
