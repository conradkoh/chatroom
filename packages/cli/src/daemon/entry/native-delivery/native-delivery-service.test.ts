import { describe, expect, test, vi } from 'vitest';

import { NativeDeliveryService } from './native-delivery-service.js';
import { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';
import { createAgentTaskStateService } from '../../services/agent-process-service/index.js';

function createService(
  options: {
    readonly onTurnEnded?: (handler: (event: never) => Promise<unknown>) => void;
  } = {}
): NativeDeliveryService {
  return new NativeDeliveryService({
    runtime: {} as never,
    effectContext: {} as never,
    agentMgr: {
      subscribeAgentTurnEnded: (handler: (event: never) => Promise<unknown>) => {
        options.onTurnEnded?.(handler);
        return () => undefined;
      },
      subscribeAgentStarted: () => () => undefined,
      subscribeAgentSessionLost: () => () => undefined,
    } as never,
    runSerializedForAgent: (async (_key: never, _options: never, operation: any) =>
      operation(
        { startAgent: vi.fn(), stopAgent: vi.fn() },
        { signal: new AbortController().signal }
      )) as never,
    sessionDeps: {} as never,
    machineId: 'machine-1',
    taskSnapshotState: new MachineTaskSnapshotState(),
    agentTaskState: createAgentTaskStateService(),
    agentOperationalReadModel: new AgentOperationalReadModel(),
    lifecycleOutbox: { enqueue: async () => undefined },
    taskService: {
      isNativeHarness: () => true,
      snapshotRequestsNativeColdSession: () => false,
      explainNativeDeliveryBlock: () => null,
      deliverNativeTask: async () => undefined,
    },
  });
}

describe('NativeDeliveryService', () => {
  test('tracks delivered task state for duplicate-delivery suppression', () => {
    const service = createService();

    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toMatchObject({
      taskId: 'task-1',
    });
  });

  test('schedules delivery after an agent-end event', async () => {
    let onTurnEnded: ((event: never) => Promise<unknown>) | undefined;
    const service = createService({
      onTurnEnded: (handler) => {
        onTurnEnded = handler;
      },
    });

    await onTurnEnded?.({
      chatroomId: 'room-1',
      role: 'builder',
      pid: 42,
      harness: 'cursor-sdk',
      slot: { state: 'running' },
      eventId: 'turn-1',
    } as never);
    service.dispose();
  });
});
