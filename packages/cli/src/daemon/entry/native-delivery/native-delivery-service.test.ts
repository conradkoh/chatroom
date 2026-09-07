import { describe, expect, test } from 'vitest';

import { NativeDeliveryService } from './native-delivery-service.js';
import { createAgentTaskStateService } from '../../infrastructure/agent-process-manager/components/agent-task-state/index.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';

function createService(): NativeDeliveryService {
  return new NativeDeliveryService({
    runtime: {} as never,
    effectContext: {} as never,
    agentMgr: {} as never,
    runSerializedForAgent: async <T>() => undefined as T,
    sessionDeps: {} as never,
    machineId: 'machine-1',
    taskSnapshotState: new MachineTaskSnapshotState(),
    agentTaskState: createAgentTaskStateService({
      reminder: { remind: async () => undefined },
    }),
  });
}

describe('NativeDeliveryService', () => {
  test('owns delivery and handoff state transitions', async () => {
    const service = createService();

    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toMatchObject({
      taskId: 'task-1',
      handedOff: false,
    });

    await service.handleTaskInboxUpdate(
      {
        signals: [
          {
            chatroomId: 'room-1',
            targetRole: 'builder',
            taskId: 'task-1',
            taskStatus: 'completed',
          },
        ],
        snapshots: [],
      } as never
    );

    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toMatchObject({
      taskId: 'task-1',
      handedOff: true,
    });
  });
});
