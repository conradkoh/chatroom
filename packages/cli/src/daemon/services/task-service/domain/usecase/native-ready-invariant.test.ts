import { describe, expect, it } from 'vitest';

import { explainAgentReadyForNativeDeliveryBlock } from './native-ready-invariant.js';
import { TaskAssigneeType } from '../../../../domain/entities/assigned-task.js';

const task = (overrides: Record<string, unknown> = {}) =>
  ({
    taskId: 'task-1',
    chatroomId: 'room-1',
    status: 'pending',
    assignedTo: 'builder',
    updatedAt: 1,
    createdAt: 1,
    agentConfig: {
      role: 'builder',
      machineId: 'machine-1',
      agentHarness: 'cursor-sdk',
      workingDir: '/tmp',
    },
    assignee: {
      type: TaskAssigneeType.Ephemeral,
      ephemeral: {
        agentHarness: 'cursor-sdk',
        model: 'test-model',
        workingDir: '/tmp',
      },
    },
    participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
    ...overrides,
  }) as never;

const idleSlot = (overrides: Record<string, unknown> = {}) =>
  ({
    state: 'running',
    pid: 99,
    harnessSessionId: 'harness-1',
    nativeTurnPhase: 'idle',
    ...overrides,
  }) as never;

describe('native-ready-invariant', () => {
  it('allows delivery-owned cold spawn when slot is down', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(task({ requestsNativeColdSession: true }), undefined)
    ).toBeNull();
  });

  it('still blocks when the locally running slot has a turn in flight', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(
        task({
          agentConfig: {
            role: 'builder',
            machineId: 'machine-1',
            agentHarness: 'cursor-sdk',
            workingDir: '/tmp',
          },
        }),
        idleSlot({ pid: 42, nativeTurnPhase: 'turn_in_flight' })
      )
    ).toBe('turn_not_idle (nativeTurnPhase=turn_in_flight)');
  });

  it('allows a healthy local slot without backend process metadata', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(
        task({
          agentConfig: {
            role: 'builder',
            machineId: 'machine-1',
            agentHarness: 'cursor-sdk',
            workingDir: '/tmp',
          },
        }),
        idleSlot({ pid: 123 })
      )
    ).toBeNull();
  });

  it('blocks when the local slot is not running', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(
        task({
          agentConfig: {
            role: 'builder',
            machineId: 'machine-1',
            agentHarness: 'cursor-sdk',
            workingDir: '/tmp',
          },
        }),
        idleSlot({ pid: 99, state: 'spawning' })
      )
    ).toBe('slot_not_running (slotState=spawning)');
  });
});
