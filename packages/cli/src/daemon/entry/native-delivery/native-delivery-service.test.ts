import { describe, expect, test, vi } from 'vitest';

import { NativeDeliveryService } from './native-delivery-service.js';
import { startPendingNativeAgents } from './task-delivery-processor.js';
import { createAgentTaskStateService } from '../../infrastructure/agent-process-manager/components/agent-task-state/index.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';
import { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';

function createService(options: {
  readonly reminder?: { remind: (input: unknown) => Promise<void> };
  readonly onTurnEnded?: (handler: (event: never) => Promise<unknown>) => void;
} = {}): NativeDeliveryService {
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
      operation({ startAgent: vi.fn(), stopAgent: vi.fn() }, { signal: new AbortController().signal })) as never,
    sessionDeps: {} as never,
    machineId: 'machine-1',
    taskSnapshotState: new MachineTaskSnapshotState(),
    agentTaskState: createAgentTaskStateService({
      reminder: options.reminder ?? { remind: async () => undefined },
    }),
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

  test('routes an agent-end event through daemon task state and requests a reminder', async () => {
    const remind = vi.fn().mockResolvedValue(undefined);
    let onTurnEnded: ((event: never) => Promise<unknown>) | undefined;
    const service = createService({
      reminder: { remind },
      onTurnEnded: (handler) => {
        onTurnEnded = handler;
      },
    });

    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
    await onTurnEnded?.({
      chatroomId: 'room-1',
      role: 'builder',
      pid: 42,
      harness: 'cursor-sdk',
      slot: { state: 'running' },
      eventId: 'turn-1',
    } as never);

    expect(remind).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-1',
      attempt: 1,
    });
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toMatchObject({
      status: 'reminder_requested',
      reminderAttempts: 1,
    });
  });

  test('does not lose task-state accounting when the reminder dependency fails', async () => {
    const remind = vi.fn().mockRejectedValue(new Error('reminder unavailable'));
    const service = createService({ reminder: { remind } });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await expect(
      service.handleAgentTurnEnded({
        chatroomId: 'room-1',
        role: 'builder',
        pid: 42,
        harness: 'cursor-sdk',
        slot: { state: 'running' },
        eventId: 'turn-1',
      })
    ).rejects.toThrow('reminder unavailable');
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toMatchObject({
      status: 'reminder_requested',
      reminderAttempts: 1,
    });
  });
});
