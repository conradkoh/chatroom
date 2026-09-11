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
  agentConfig: {
    role: 'builder',
    machineId: 'machine-1',
  },
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
    slot: { state: 'running', pid: 42, harnessSessionId: 'session-1', nativeTurnPhase: 'idle' },
    activeTaskId: undefined,
    deliveryInFlight: false,
    agentLifecycleInFlight: false,
    isNativeHarness: (harness) => harness.endsWith('-sdk'),
    taskRequestsNativeColdSession: (row) => row.requestsNativeColdSession === true,
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
    const explain = vi.fn(() => 'slot_missing');
    expect(
      decideNextDelivery(
        [task()],
        context({ slot: { state: 'idle' }, explainNativeDeliveryBlock: explain })
      )
    ).toEqual({ kind: 'start-agent', taskId: 'task-1' });
  });

  test('starts pending work when the local slot and backend PID are both missing', () => {
    const explain = vi.fn(() => 'slot_missing');
    expect(
      decideNextDelivery(
        [task()],
        context({ slot: undefined, explainNativeDeliveryBlock: explain })
      )
    ).toEqual({ kind: 'start-agent', taskId: 'task-1' });
  });

  test('waits for a spawning or stopping slot', () => {
    const explain = vi.fn(() => 'slot_not_running (slotState=spawning)');
    expect(
      decideNextDelivery(
        [task()],
        context({ slot: { state: 'spawning' }, explainNativeDeliveryBlock: explain })
      )
    ).toEqual({ kind: 'wait', taskId: 'task-1', reason: 'slot_spawning' });
  });

  test('waits for the agent to become idle before delivering', () => {
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
    ).toEqual({ kind: 'wait', taskId: 'task-1', reason: 'turn_not_idle' });
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
      kind: 'blocked',
      taskId: 'task-1',
      reason: 'task_status_not_deliverable',
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

  test.each([
    'not_native_harness',
    'acknowledged_wrong_role',
    'chatroom_stop_scope_active',
    'slot_missing',
    'slot_not_running',
    'slot_pid_missing',
    'working_dir_missing',
  ] as const)('preserves stable blocked reason %s', (reason) => {
    expect(
      decideNextDelivery([task()], context({ explainNativeDeliveryBlock: vi.fn(() => reason) }))
    ).toEqual({ kind: 'blocked', taskId: 'task-1', reason });
  });

  test('waits while an agent lifecycle operation is in flight', () => {
    expect(decideNextDelivery([task()], context({ agentLifecycleInFlight: true }))).toEqual({
      kind: 'wait',
      taskId: 'task-1',
      reason: 'agent_start_in_flight',
    });
  });

  test('waits for a missing harness session', () => {
    expect(
      decideNextDelivery(
        [task()],
        context({ explainNativeDeliveryBlock: vi.fn(() => 'harness_session_missing') })
      )
    ).toEqual({ kind: 'wait', taskId: 'task-1', reason: 'session_not_ready' });
  });
});
