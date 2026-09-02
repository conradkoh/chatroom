import { Context, Runtime } from 'effect';
import { afterEach, describe, expect, test } from 'vitest';

import { unregisterNativeDeliverySession } from './native-delivery-session-registry.js';
import { decideNativeTurnEndFromInbox } from './native-turn-end-inbox.js';
import type { AssignedTaskSnapshotView } from '../../../daemon/domain/entities/assigned-task.js';
import { registerTestNativeDeliverySession } from '../../infrastructure/agent-operational/test-support.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';

function makeRow(status: AssignedTaskSnapshotView['status']): AssignedTaskSnapshotView {
  return {
    taskId: 'task_1',
    chatroomId: 'room_1',
    status,
    assignedTo: 'builder',
    updatedAt: 1,
    createdAt: 1,
    agentConfig: { role: 'builder', machineId: 'machine_1', agentHarness: 'cursor-sdk' },
  };
}

describe('native turn-end inbox decision', () => {
  afterEach(() => unregisterNativeDeliverySession());

  test('remains unknown before inbox bootstrap', () => {
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: {} as never,
      sessionDeps: {} as never,
      machineId: 'machine_1',
      taskSnapshotState: new MachineTaskSnapshotState(),
    });

    expect(
      decideNativeTurnEndFromInbox({ chatroomId: 'room_1', role: 'builder', taskId: 'task_1' })
    ).toBe('unknown');
  });

  test('follows the inbox task lifecycle without a backend query', () => {
    const taskSnapshotState = new MachineTaskSnapshotState();
    taskSnapshotState.replace([makeRow('in_progress')]);
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: {} as never,
      sessionDeps: {} as never,
      machineId: 'machine_1',
      taskSnapshotState,
    });

    const args = { chatroomId: 'room_1', role: 'builder', taskId: 'task_1' };
    expect(decideNativeTurnEndFromInbox(args)).toBe('needs-handoff-reminder');

    taskSnapshotState.applySignalPage(
      [
        {
          chatroomId: 'room_1' as never,
          taskId: 'task_1' as never,
          targetRole: 'builder',
          taskStatus: 'completed',
          signalKey: '0000000000000002:task_1',
          taskUpdatedAt: 2,
        },
      ],
      []
    );
    expect(decideNativeTurnEndFromInbox(args)).toBe('handoff-completed');
  });

  test('keeps acknowledged tasks on the backend fallback', () => {
    const taskSnapshotState = new MachineTaskSnapshotState();
    taskSnapshotState.replace([makeRow('acknowledged')]);
    registerTestNativeDeliverySession({
      runtime: Runtime.defaultRuntime as never,
      effectContext: Context.empty() as never,
      agentMgr: {} as never,
      sessionDeps: {} as never,
      machineId: 'machine_1',
      taskSnapshotState,
    });

    expect(
      decideNativeTurnEndFromInbox({ chatroomId: 'room_1', role: 'builder', taskId: 'task_1' })
    ).toBe('unknown');
  });
});
