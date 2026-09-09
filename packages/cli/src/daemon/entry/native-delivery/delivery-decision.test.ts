import { describe, expect, test, vi } from 'vitest';

import { decideNextDelivery } from './delivery-decision.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';

const task = (overrides: Partial<AssignedTaskSnapshotView> = {}): AssignedTaskSnapshotView => ({
  taskId: 'task-1',
  chatroomId: 'room-1',
  status: 'pending',
  assignedTo: 'builder',
  createdAt: 1,
  updatedAt: 1,
  agentConfig: {
    role: 'builder',
    machineId: 'machine-1',
    agentHarness: 'codex-sdk',
    workingDir: '/workspace',
  },
  ...overrides,
});

function context(
  overrides: Partial<Parameters<typeof decideNextDelivery>[1]> = {}
): Parameters<typeof decideNextDelivery>[1] {
  return {
    role: 'builder',
    slot: { state: 'running', pid: 42, harnessSessionId: 'session-1', nativeTurnPhase: 'idle' },
    operational: { operationalState: 'running', stopState: 'idle' },
    activeTaskId: undefined,
    deliveryInFlight: false,
    isNativeHarness: (harness) => harness.endsWith('-sdk'),
    snapshotRequestsNativeColdSession: (row) => row.requestsNativeColdSession === true,
    explainNativeDeliveryBlock: vi.fn(() => null),
    ...overrides,
  };
}

describe('decideNextDelivery', () => {
  test('returns inject for a ready native role', () => {
    expect(decideNextDelivery([task()], context())).toEqual({
      kind: 'inject',
      taskId: 'task-1',
      harnessSessionId: 'session-1',
    });
  });

  test('returns start-agent for pending work and an idle slot', () => {
    const explain = vi.fn(() => 'slot_missing (expectedPid=none)');
    expect(
      decideNextDelivery(
        [task()],
        context({ slot: { state: 'idle' }, explainNativeDeliveryBlock: explain })
      )
    ).toEqual({ kind: 'start-agent', taskId: 'task-1' });
  });

  test('waits for a spawning or stopping slot', () => {
    const explain = vi.fn(() => 'slot_not_running (slotState=spawning, expectedPid=none)');
    expect(
      decideNextDelivery(
        [task()],
        context({ slot: { state: 'spawning' }, explainNativeDeliveryBlock: explain })
      )
    ).toEqual({ kind: 'wait', taskId: 'task-1', reason: 'slot_spawning' });
  });

  test('returns an explicit blocked reason for a non-idle turn', () => {
    const explain = vi.fn(() => 'turn_not_idle (nativeTurnPhase=turn_in_flight)');
    expect(
      decideNextDelivery(
        [task()],
        context({
          slot: {
            state: 'running',
            pid: 42,
            harnessSessionId: 'session-1',
            nativeTurnPhase: 'turn_in_flight',
          },
          explainNativeDeliveryBlock: explain,
        })
      )
    ).toEqual({ kind: 'blocked', taskId: 'task-1', reason: 'turn_not_idle' });
  });

  test('deduplicates an active task and an in-flight delivery', () => {
    expect(decideNextDelivery([task()], context({ activeTaskId: 'task-1' }))).toEqual({
      kind: 'deduplicated',
      taskId: 'task-1',
      reason: 'task_state_active',
    });
    expect(decideNextDelivery([task()], context({ deliveryInFlight: true }))).toEqual({
      kind: 'deduplicated',
      taskId: 'task-1',
      reason: 'delivery_in_flight',
    });
  });

  test('returns idle when no task is deliverable', () => {
    expect(decideNextDelivery([task({ status: 'in_progress' })], context())).toEqual({
      kind: 'idle',
      reason: 'no_deliverable_task',
    });
  });

  test('distinguishes a task assigned to another role', () => {
    expect(
      decideNextDelivery(
        [task({ agentConfig: { ...task().agentConfig, role: 'planner' } })],
        context()
      )
    ).toEqual({ kind: 'idle', reason: 'not_assigned' });
  });

  test('keeps operational stop and circuit reasons blocked', () => {
    expect(
      decideNextDelivery(
        [task()],
        context({
          explainNativeDeliveryBlock: vi.fn(() => 'operational_stop_intent_active'),
        })
      )
    ).toEqual({
      kind: 'blocked',
      taskId: 'task-1',
      reason: 'operational_stop_intent_active',
    });
    expect(
      decideNextDelivery(
        [task()],
        context({ explainNativeDeliveryBlock: vi.fn(() => 'operational_circuit_open') })
      )
    ).toEqual({ kind: 'blocked', taskId: 'task-1', reason: 'operational_circuit_open' });
  });
});
