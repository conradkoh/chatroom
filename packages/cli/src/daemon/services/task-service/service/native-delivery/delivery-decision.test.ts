import { describe, expect, test, vi } from 'vitest';

import { decideNextDelivery } from './delivery-decision.js';
import { TaskAssigneeType, type AssignedTask } from '../../../../domain/entities/assigned-task.js';

const task = (overrides: Partial<AssignedTask> = {}): AssignedTask => ({
  taskId: 'task-1',
  chatroomId: 'room-1',
  status: 'pending',
  assignedTo: 'builder',
  createdAt: 1,
  updatedAt: 1,
  agentConfig: { role: 'builder', machineId: 'machine-1' },
  assignee: {
    type: TaskAssigneeType.Ephemeral,
    ephemeral: { agentHarness: 'codex-sdk', model: 'model-1', workingDir: '/workspace' },
  },
  ...overrides,
});

function context(
  overrides: Partial<Parameters<typeof decideNextDelivery>[1]> = {}
): Parameters<typeof decideNextDelivery>[1] {
  return {
    role: 'builder',
    activeTaskId: undefined,
    agentConfig: { agentHarness: 'codex-sdk', model: 'model-1', workingDir: '/workspace' },
    configState: 'ready',
    isNativeHarness: (harness) => harness.endsWith('-sdk'),
    explainNativeDeliveryBlock: vi.fn(() => null),
    ...overrides,
  };
}

describe('decideNextDelivery', () => {
  test('returns deliver for a valid task without inspecting slot state', () => {
    expect(decideNextDelivery([task()], context())).toEqual({ kind: 'deliver', taskId: 'task-1' });
  });

  test.each(['in_progress', 'completed' as never] as const)(
    'idles for a non-deliverable task (%s)',
    (status) => {
      expect(decideNextDelivery([task({ status })], context())).toEqual({
        kind: 'idle',
        reason: 'not_assigned',
      });
    }
  );

  test('fails an acknowledged task assigned elsewhere', () => {
    expect(
      decideNextDelivery([task({ status: 'acknowledged', assignedTo: 'planner' })], context())
    ).toEqual({ kind: 'failed', taskId: 'task-1', reason: 'assigned_elsewhere' });
  });

  test('waits while configuration sync is pending', () => {
    expect(decideNextDelivery([task()], context({ agentConfig: undefined }))).toEqual({
      kind: 'waiting',
      taskId: 'task-1',
      reason: 'config_sync_lag',
    });
  });

  test('fails for an unsupported harness', () => {
    expect(decideNextDelivery([task()], context({ isNativeHarness: () => false }))).toEqual({
      kind: 'failed',
      taskId: 'task-1',
      reason: 'unsupported_harness',
    });
  });

  test('deduplicates an active task', () => {
    expect(decideNextDelivery([task()], context({ activeTaskId: 'task-1' }))).toEqual({
      kind: 'deduplicated',
      taskId: 'task-1',
      reason: 'task_state_active',
    });
  });
});
