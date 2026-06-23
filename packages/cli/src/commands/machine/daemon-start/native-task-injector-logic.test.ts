import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/get-assigned-tasks.js';
import { describe, expect, test } from 'vitest';

import {
  buildNativeInjectionPrompt,
  isNativeHarness,
  NativeInjectionDedup,
  shouldInjectNativeTask,
  shouldNudgeNativeInjection,
} from './native-task-injector-logic.js';

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

describe('isNativeHarness', () => {
  test('cursor-sdk and opencode-sdk are native', () => {
    expect(isNativeHarness('cursor-sdk')).toBe(true);
    expect(isNativeHarness('opencode-sdk')).toBe(true);
  });

  test('CLI harnesses are not native', () => {
    expect(isNativeHarness('opencode')).toBe(false);
    expect(isNativeHarness('cursor')).toBe(false);
  });
});

describe('shouldInjectNativeTask', () => {
  test('injects when native + pending + alive + native:waiting', () => {
    expect(shouldInjectNativeTask(makeTask())).toBe(true);
  });

  test('injects when native + pending + alive + lastSeenAction=null (fresh spawn)', () => {
    expect(
      shouldInjectNativeTask(
        makeTask({
          participant: {
            lastSeenAction: null,
            lastSeenAt: null,
            lastStatus: null,
          },
        })
      )
    ).toBe(true);
  });

  test('does not inject when no PID', () => {
    expect(
      shouldInjectNativeTask(
        makeTask({
          agentConfig: { ...makeTask().agentConfig, spawnedAgentPid: undefined },
        })
      )
    ).toBe(false);
  });

  test('does not inject when status is in_progress', () => {
    expect(shouldInjectNativeTask(makeTask({ status: 'in_progress' }))).toBe(false);
  });

  test('does not inject CLI harness', () => {
    expect(
      shouldInjectNativeTask(
        makeTask({
          agentConfig: { ...makeTask().agentConfig, agentHarness: 'opencode' },
          participant: {
            lastSeenAction: 'get-next-task:started',
            lastSeenAt: 500,
            lastStatus: 'agent.waiting',
          },
        })
      )
    ).toBe(false);
  });

  test('deduplicates duplicate subscription events', () => {
    const dedup = new NativeInjectionDedup();
    const task = makeTask();
    dedup.markInjected(task.taskId);
    expect(shouldInjectNativeTask(task, { alreadyInjectedTaskIds: dedup })).toBe(false);
  });

  test('injects when task completed but lastSeenAction still task-injected', () => {
    expect(
      shouldInjectNativeTask(
        makeTask({
          participant: {
            lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
            lastSeenAt: 1_000,
            lastStatus: 'task.completed',
          },
        })
      )
    ).toBe(true);
  });

  test('does not inject when lastSeenAction is non-injectable', () => {
    expect(
      shouldInjectNativeTask(
        makeTask({
          participant: {
            lastSeenAction: 'get-next-task:started',
            lastSeenAt: 500,
            lastStatus: 'agent.waiting',
          },
        })
      )
    ).toBe(false);
  });
});

describe('shouldNudgeNativeInjection', () => {
  test('nudges when native:waiting + pending >15s', () => {
    const createdAt = 1_000;
    const now = createdAt + 15_001;
    expect(
      shouldNudgeNativeInjection(
        makeTask({
          createdAt,
          participant: {
            lastSeenAction: NATIVE_WAITING_ACTION,
            lastSeenAt: createdAt,
            lastStatus: 'agent.waiting',
          },
        }),
        now
      )
    ).toBe(true);
  });

  test('nudges when native:task-injected + acknowledged + stale >15s', () => {
    const lastSeenAt = 1_000;
    const now = lastSeenAt + 15_001;
    expect(
      shouldNudgeNativeInjection(
        makeTask({
          participant: {
            lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
            lastSeenAt,
            lastStatus: 'task.acknowledged',
          },
        }),
        now
      )
    ).toBe(true);
  });

  test('does not nudge CLI harness', () => {
    expect(
      shouldNudgeNativeInjection(
        makeTask({
          agentConfig: { ...makeTask().agentConfig, agentHarness: 'opencode' },
        }),
        100_000
      )
    ).toBe(false);
  });
});

describe('buildNativeInjectionPrompt', () => {
  test('adds compaction header for compress_context=new_session', () => {
    const output = buildNativeInjectionPrompt({
      taskDeliveryOutput: 'TASK BODY',
      compressMode: 'new_session',
    });
    expect(output).toContain('Context was compacted');
    expect(output).toContain('only if role instructions are missing');
    expect(output).toContain('TASK BODY');
  });

  test('no compaction header for compress_context=none', () => {
    const output = buildNativeInjectionPrompt({
      taskDeliveryOutput: 'TASK BODY',
      compressMode: 'none',
    });
    expect(output).toBe('TASK BODY');
    expect(output).not.toContain('Session Management');
  });
});

describe('NativeInjectionDedup', () => {
  test('tracks injected task IDs', () => {
    const dedup = new NativeInjectionDedup();
    expect(dedup.has('task_a')).toBe(false);
    dedup.markInjected('task_a');
    expect(dedup.has('task_a')).toBe(true);
    dedup.clear('task_a');
    expect(dedup.has('task_a')).toBe(false);
  });
});
