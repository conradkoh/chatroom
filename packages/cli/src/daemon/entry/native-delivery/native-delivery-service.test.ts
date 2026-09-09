import { describe, expect, test, vi } from 'vitest';

import { NativeDeliveryService } from './native-delivery-service.js';
import { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';
import { createAgentTaskStateService } from '../../services/agent-process-service/index.js';

function createService(
  options: {
    readonly onTurnEnded?: (handler: (event: never) => Promise<unknown>) => void;
    readonly onAgentStarted?: (handler: (event: never) => Promise<unknown>) => void;
    readonly onSessionLost?: (handler: (event: never) => void) => void;
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
      subscribeAgentStarted: (handler: (event: never) => Promise<unknown>) => {
        options.onAgentStarted?.(handler);
        return () => undefined;
      },
      subscribeAgentSessionLost: (handler: (event: never) => void) => {
        options.onSessionLost?.(handler);
        return () => undefined;
      },
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
    const requestReconcile = vi.spyOn(service, 'requestReconcile').mockResolvedValue(undefined);

    await onTurnEnded?.({
      chatroomId: 'room-1',
      role: 'builder',
      pid: 42,
      harness: 'cursor-sdk',
      slot: { state: 'running' },
      eventId: 'turn-1',
    } as never);
    await vi.waitFor(() => {
      expect(requestReconcile).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        source: 'turn-ended',
      });
    });
    service.dispose();
  });

  test('routes agent-started lifecycle events through reconciliation', async () => {
    let onAgentStarted: ((event: never) => Promise<unknown>) | undefined;
    const service = createService({
      onAgentStarted: (handler) => {
        onAgentStarted = handler;
      },
    });
    const requestReconcile = vi.spyOn(service, 'requestReconcile').mockResolvedValue(undefined);

    await onAgentStarted?.({ chatroomId: 'room-1', role: 'builder' } as never);

    expect(requestReconcile).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      source: 'agent-started',
    });
    service.dispose();
  });

  test('clears stale active-task state when the agent session is lost', () => {
    let onSessionLost: ((event: never) => void) | undefined;
    const service = createService({
      onSessionLost: (handler) => {
        onSessionLost = handler;
      },
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    onSessionLost?.({ chatroomId: 'room-1', role: 'builder' } as never);

    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    service.dispose();
  });

  test('coalesces duplicate role reconciliations and runs a fresh pass afterward', async () => {
    const service = createService();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const processSnapshots = vi
      .spyOn(service, 'processSnapshots')
      .mockImplementationOnce(async () => gate)
      .mockResolvedValue(undefined);

    const first = service.requestReconcile({
      chatroomId: 'room-1',
      role: 'Builder',
      source: 'task-signal',
    });
    const second = service.requestReconcile({
      chatroomId: 'room-1',
      role: 'builder',
      source: 'operational-signal',
    });

    release();
    await Promise.all([first, second]);

    expect(processSnapshots).toHaveBeenCalledTimes(2);
    expect(processSnapshots).toHaveBeenNthCalledWith(
      2,
      'operational-signal',
      expect.any(Array),
      undefined
    );
  });
});
