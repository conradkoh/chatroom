import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { describe, expect, test } from 'vitest';

import {
  buildNativeInjectionPrompt,
  explainNativeDeliveryBlock,
  isNativeHarness,
  shouldDeliverNativeTask,
} from './native-task-injector-logic.js';
import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';

const runningSlot: AgentSlot = {
  state: 'running',
  pid: 12345,
  harnessSessionId: 'sess_1',
  nativeTurnPhase: 'idle',
};

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
  test('cursor-sdk, opencode-sdk, and claude-sdk are native', () => {
    expect(isNativeHarness('cursor-sdk')).toBe(true);
    expect(isNativeHarness('opencode-sdk')).toBe(true);
    expect(isNativeHarness('claude-sdk')).toBe(true);
  });

  test('CLI harnesses are not native', () => {
    expect(isNativeHarness('opencode')).toBe(false);
    expect(isNativeHarness('cursor')).toBe(false);
  });
});

describe('shouldDeliverNativeTask', () => {
  test('delivers when native + pending + ready invariant satisfied', () => {
    expect(
      shouldDeliverNativeTask(makeTask(), {
        slot: runningSlot,
      })
    ).toBe(true);
  });

  test('does not deliver when harness session is missing on slot', () => {
    expect(
      shouldDeliverNativeTask(makeTask(), {
        slot: { ...runningSlot, harnessSessionId: undefined },
      })
    ).toBe(false);
  });

  test('delivers pending task after prior injection (redelivery after release)', () => {
    expect(
      shouldDeliverNativeTask(
        makeTask({
          status: 'pending',
          participant: {
            lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
            lastSeenAt: 1_000,
            lastStatus: 'task.acknowledged',
          },
        }),
        { slot: runningSlot }
      )
    ).toBe(true);
  });

  test('delivers when idle after task complete (post-handoff promoted task)', () => {
    expect(
      shouldDeliverNativeTask(
        makeTask({
          participant: {
            lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
            lastSeenAt: 2_000,
            lastStatus: 'task.completed',
          },
        }),
        { slot: runningSlot }
      )
    ).toBe(true);
  });

  test('does not deliver when task-injected and still in progress', () => {
    expect(
      shouldDeliverNativeTask(
        makeTask({
          status: 'in_progress',
          participant: {
            lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
            lastSeenAt: 2_000,
            lastStatus: 'task.inProgress',
          },
        }),
        { slot: runningSlot }
      )
    ).toBe(false);
  });

  test('does not deliver when status is in_progress', () => {
    expect(
      shouldDeliverNativeTask(makeTask({ status: 'in_progress' }), {
        slot: runningSlot,
      })
    ).toBe(false);
  });

  test('delivers acknowledged task owned by this role when ready', () => {
    expect(
      shouldDeliverNativeTask(
        makeTask({
          status: 'acknowledged',
          assignedTo: 'builder',
        }),
        { slot: runningSlot }
      )
    ).toBe(true);
  });

  test('does not deliver when harness turn is still in flight', () => {
    expect(
      shouldDeliverNativeTask(makeTask(), {
        slot: { ...runningSlot, nativeTurnPhase: 'turn_in_flight' },
      })
    ).toBe(false);
    expect(
      explainNativeDeliveryBlock(makeTask(), {
        slot: { ...runningSlot, nativeTurnPhase: 'turn_in_flight' },
      })
    ).toContain('turn_not_idle');
  });

  test('does not deliver when harness is injecting', () => {
    expect(
      shouldDeliverNativeTask(makeTask(), {
        slot: { ...runningSlot, nativeTurnPhase: 'injecting' },
      })
    ).toBe(false);
  });

  test('does not deliver when turn in flight even if participant is native:waiting', () => {
    expect(
      shouldDeliverNativeTask(
        makeTask({
          participant: {
            lastSeenAction: NATIVE_WAITING_ACTION,
            lastSeenAt: 500,
            lastStatus: 'agent.waiting',
          },
        }),
        { slot: { ...runningSlot, nativeTurnPhase: 'turn_in_flight' } }
      )
    ).toBe(false);
  });

  test('acknowledged retry delivers when slot is idle', () => {
    expect(
      shouldDeliverNativeTask(
        makeTask({
          status: 'acknowledged',
          assignedTo: 'builder',
          participant: {
            lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
            lastSeenAt: 2_000,
            lastStatus: 'task.acknowledged',
          },
        }),
        { slot: runningSlot }
      )
    ).toBe(true);
  });
});

describe('buildNativeInjectionPrompt', () => {
  test('adds compaction preamble for session_augmentation=compact', () => {
    const output = buildNativeInjectionPrompt({
      taskDeliveryOutput: 'TASK BODY',
      augmentationMode: 'compact',
    });
    expect(output).toContain('Context was compacted');
    expect(output).toContain('TASK BODY');
  });
});
