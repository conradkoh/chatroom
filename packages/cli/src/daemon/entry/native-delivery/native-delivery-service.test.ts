import { describe, expect, test, vi } from 'vitest';

import { NativeDeliveryService } from './native-delivery-service.js';
import { startPendingNativeAgents } from './task-delivery-processor.js';
import { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import { createAgentTaskStateService } from '../../services/agent-process-service/infrastructure/components/agent-task-state/index.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';

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
  });
}

describe('NativeDeliveryService', () => {
  test('activates pending work through the serialized process-manager operation', async () => {
    const startAgent = vi.fn().mockResolvedValue({ success: true, pid: 42 });
    const runSerializedForAgent = vi.fn(async (_key, _options, operation) =>
      operation({ startAgent, stopAgent: vi.fn() }, { signal: new AbortController().signal })
    );
    await startPendingNativeAgents(
      [
        {
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
          participant: { lastSeenAction: null, lastSeenAt: null, lastStatus: null },
        },
      ] as never,
      { getSlot: () => undefined } as never,
      runSerializedForAgent as never,
      { isNativeHarness: () => true, snapshotRequestsNativeColdSession: () => false } as never,
      new AgentOperationalReadModel()
    );
    expect(startAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'room-1',
        role: 'builder',
        wantResume: false,
        reason: 'platform.pending_task_wake',
      }),
      expect.anything()
    );
  });

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
