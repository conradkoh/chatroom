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
    agentConfig: { role: 'builder', machineId: 'machine-1' },
    assignee: {
      type: TaskAssigneeType.Ephemeral,
      ephemeral: { agentHarness: 'cursor-sdk', model: 'test-model', workingDir: '/tmp' },
    },
    ...overrides,
  }) as never;

describe('native-ready-invariant', () => {
  it('allows delivery-owned cold spawn when no stop scope is active', () => {
    expect(
      explainAgentReadyForNativeDeliveryBlock(task({ requestsNativeColdSession: true }))
    ).toBeNull();
  });

  it('does not block normal delivery based on process state', () => {
    expect(explainAgentReadyForNativeDeliveryBlock(task())).toBeNull();
  });
});
