import {
  NATIVE_TASK_INJECTED_ACTION,
  NATIVE_WAITING_ACTION,
} from '@workspace/backend/src/domain/entities/participant.js';
import type { AssignedTaskView } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { describe, expect, test } from 'vitest';

import { NativeDeliveryLedger } from './native-delivery-ledger.js';
import {
  buildNativeInjectionPrompt,
  isNativeHarness,
  shouldDeliverNativeTask,
} from './native-task-injector-logic.js';

const HARNESS_SESSION_ID = 'sess_1';

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
  test('delivers when native + pending + alive + native:waiting', () => {
    const ledger = new NativeDeliveryLedger();
    expect(
      shouldDeliverNativeTask(makeTask(), {
        ledger,
        harnessSessionId: HARNESS_SESSION_ID,
      })
    ).toBe(true);
  });

  test('delivers with UUID provisional harnessSessionId before first turn', () => {
    const ledger = new NativeDeliveryLedger();
    const provisionalId = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
    expect(
      shouldDeliverNativeTask(
        makeTask({
          agentConfig: { ...makeTask().agentConfig, agentHarness: 'claude-sdk' },
        }),
        { ledger, harnessSessionId: provisionalId }
      )
    ).toBe(true);
  });

  test('delivers when native + pending + alive + lastSeenAction=null (fresh spawn)', () => {
    const ledger = new NativeDeliveryLedger();
    expect(
      shouldDeliverNativeTask(
        makeTask({
          participant: {
            lastSeenAction: null,
            lastSeenAt: null,
            lastStatus: null,
          },
        }),
        { ledger, harnessSessionId: HARNESS_SESSION_ID }
      )
    ).toBe(true);
  });

  test('does not deliver when no PID', () => {
    const ledger = new NativeDeliveryLedger();
    expect(
      shouldDeliverNativeTask(
        makeTask({
          agentConfig: { ...makeTask().agentConfig, spawnedAgentPid: undefined },
        }),
        { ledger, harnessSessionId: HARNESS_SESSION_ID }
      )
    ).toBe(false);
  });

  test('does not deliver when harness session is missing', () => {
    const ledger = new NativeDeliveryLedger();
    expect(shouldDeliverNativeTask(makeTask(), { ledger, harnessSessionId: undefined })).toBe(
      false
    );
  });

  test('does not deliver when status is in_progress', () => {
    const ledger = new NativeDeliveryLedger();
    expect(
      shouldDeliverNativeTask(makeTask({ status: 'in_progress' }), {
        ledger,
        harnessSessionId: HARNESS_SESSION_ID,
      })
    ).toBe(false);
  });

  test('does not deliver CLI harness', () => {
    const ledger = new NativeDeliveryLedger();
    expect(
      shouldDeliverNativeTask(
        makeTask({
          agentConfig: { ...makeTask().agentConfig, agentHarness: 'opencode' },
          participant: {
            lastSeenAction: 'get-next-task:started',
            lastSeenAt: 500,
            lastStatus: 'agent.waiting',
          },
        }),
        { ledger, harnessSessionId: HARNESS_SESSION_ID }
      )
    ).toBe(false);
  });

  test('deduplicates duplicate subscription events for same harness session', () => {
    const ledger = new NativeDeliveryLedger();
    const task = makeTask();
    ledger.markDelivered(task.taskId, HARNESS_SESSION_ID);
    expect(shouldDeliverNativeTask(task, { ledger, harnessSessionId: HARNESS_SESSION_ID })).toBe(
      false
    );
  });

  test('allows delivery again when harness session generation changes', () => {
    const ledger = new NativeDeliveryLedger();
    const task = makeTask();
    ledger.markDelivered(task.taskId, 'sess_old');
    expect(shouldDeliverNativeTask(task, { ledger, harnessSessionId: 'sess_new' })).toBe(true);
  });

  test('delivers when task completed but lastSeenAction still task-injected', () => {
    const ledger = new NativeDeliveryLedger();
    expect(
      shouldDeliverNativeTask(
        makeTask({
          participant: {
            lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
            lastSeenAt: 1_000,
            lastStatus: 'task.completed',
          },
        }),
        { ledger, harnessSessionId: HARNESS_SESSION_ID }
      )
    ).toBe(true);
  });

  test('delivers when acknowledged task is owned by this role (retry after claim)', () => {
    const ledger = new NativeDeliveryLedger();
    expect(
      shouldDeliverNativeTask(
        makeTask({
          status: 'acknowledged',
          assignedTo: 'builder',
          participant: {
            lastSeenAction: NATIVE_TASK_INJECTED_ACTION,
            lastSeenAt: 1_000,
            lastStatus: 'task.acknowledged',
          },
        }),
        { ledger, harnessSessionId: HARNESS_SESSION_ID }
      )
    ).toBe(true);
    expect(
      shouldDeliverNativeTask(
        makeTask({
          status: 'acknowledged',
          assignedTo: 'builder',
          participant: {
            lastSeenAction: NATIVE_WAITING_ACTION,
            lastSeenAt: 500,
            lastStatus: 'agent.waiting',
          },
        }),
        { ledger, harnessSessionId: HARNESS_SESSION_ID }
      )
    ).toBe(true);
  });

  test('does not deliver when lastSeenAction is non-injectable', () => {
    const ledger = new NativeDeliveryLedger();
    expect(
      shouldDeliverNativeTask(
        makeTask({
          participant: {
            lastSeenAction: 'get-next-task:started',
            lastSeenAt: 500,
            lastStatus: 'agent.waiting',
          },
        }),
        { ledger, harnessSessionId: HARNESS_SESSION_ID }
      )
    ).toBe(false);
  });
});

describe('buildNativeInjectionPrompt', () => {
  test('adds compaction preamble for session_augmentation=compact', () => {
    const output = buildNativeInjectionPrompt({
      taskDeliveryOutput: 'TASK BODY',
      augmentationMode: 'compact',
    });
    expect(output).toContain('Context was compacted');
    expect(output).toContain('only if role instructions are missing');
    expect(output).toContain('TASK BODY');
  });

  test('adds new-session preamble for session_augmentation=new_session', () => {
    const output = buildNativeInjectionPrompt({
      taskDeliveryOutput: 'TASK BODY',
      augmentationMode: 'new_session',
    });
    expect(output).toContain('Starting a new agent session');
    expect(output).not.toContain('Context was compacted');
    expect(output).toContain('TASK BODY');
  });

  test('no preamble for session_augmentation=none', () => {
    const output = buildNativeInjectionPrompt({
      taskDeliveryOutput: 'TASK BODY',
      augmentationMode: 'none',
    });
    expect(output).toBe('TASK BODY');
    expect(output).not.toContain('Session Augmentation');
  });
});
