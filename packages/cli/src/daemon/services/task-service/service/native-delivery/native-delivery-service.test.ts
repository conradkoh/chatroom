import { describe, expect, test, vi } from 'vitest';

import { NativeDeliveryService } from './native-delivery-service.js';
import { AgentOperationalReadModel } from '../../../../infrastructure/agent-operational/agent-operational-read-model.js';
import { MachineTaskSnapshotState } from '../../../../infrastructure/inbox/task-snapshot-state.js';
import { createAgentTaskStateService } from '../../../agent-process-service/index.js';

function createService(
  options: {
    readonly onTurnEnded?: (handler: (event: never) => Promise<unknown>) => void;
    readonly onAgentStarted?: (handler: (event: never) => Promise<unknown>) => void;
    readonly onSessionLost?: (handler: (event: never) => void) => void;
    readonly releaseTaskAfterTurnFailure?: (
      args: Record<string, string>
    ) => Promise<{ released: boolean; status: 'pending'; updatedAt: number }>;
    readonly enqueueFact?: (fact: Record<string, unknown>) => Promise<unknown>;
    readonly syncAssignedTaskSnapshots?: () => Promise<void>;
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
    lifecycleOutbox: { enqueue: (options.enqueueFact ?? (async () => undefined)) as never },
    taskService: {
      isNativeHarness: () => true,
      loadAssignedTaskForAction: async () => null,
      releaseTaskAfterTurnFailure: (options.releaseTaskAfterTurnFailure ??
        (async () => ({ released: true, status: 'pending', updatedAt: Date.now() }))) as never,
      snapshotRequestsNativeColdSession: () => false,
      explainNativeDeliveryBlock: () => null,
      deliverNativeTask: async () => undefined,
      syncAssignedTaskSnapshots: options.syncAssignedTaskSnapshots ?? (async () => undefined),
    },
  });
}

function failedTurnEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chatroomId: 'room-1',
    role: 'builder',
    pid: 42,
    harness: 'opencode-sdk',
    slot: { state: 'running', nativeTurnPhase: 'turn_in_flight' },
    eventId: 'turn-1',
    completion: {
      turnId: 'turn-1',
      status: 'failed',
      source: 'provider.transport',
      error: 'boom',
    },
    ...overrides,
  };
}

describe('NativeDeliveryService', () => {
  test('reconcileAfterAgentRestart syncs snapshots before reconciling and returns delivered task ids', async () => {
    const order: string[] = [];
    const syncAssignedTaskSnapshots = vi.fn(async () => {
      order.push('sync');
    });
    const service = createService({ syncAssignedTaskSnapshots });
    const requestReconcile = vi
      .spyOn(service, 'requestReconcile')
      .mockImplementation(async (params) => {
        order.push('reconcile');
        expect(params).toEqual({
          chatroomId: 'room-1',
          role: 'builder',
          source: 'restart-completed',
          onTaskDelivered: expect.any(Function),
        });
        params.onTaskDelivered?.({
          chatroomId: 'room-1',
          role: 'builder',
          taskId: 'task-1',
          harnessSessionId: 'session-1',
        });
        params.onTaskDelivered?.({
          chatroomId: 'room-1',
          role: 'builder',
          taskId: 'task-2',
          harnessSessionId: 'session-1',
        });
      });

    const delivered = await service.reconcileAfterAgentRestart({
      chatroomId: 'room-1',
      role: 'builder',
    });

    expect(syncAssignedTaskSnapshots).toHaveBeenCalledTimes(1);
    expect(requestReconcile).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['sync', 'reconcile']);
    expect(delivered).toEqual(['task-1', 'task-2']);
    service.dispose();
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

  test('clears stale active-task state after a successful native turn', async () => {
    const service = createService();
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    const disposition = await service.handleAgentTurnEnded({
      chatroomId: 'room-1',
      role: 'builder',
      pid: 42,
      harness: 'opencode-sdk',
      slot: { state: 'running', nativeTurnPhase: 'turn_in_flight' },
      eventId: 'turn-1',
      completion: {
        turnId: 'turn-1',
        status: 'completed',
        source: 'provider.result',
      },
    } as never);

    expect(disposition).toEqual({ kind: 'release-slot' });
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    service.dispose();
  });

  test('clears stale active-task state before reconciling a newly started agent', async () => {
    let onAgentStarted: ((event: never) => Promise<unknown>) | undefined;
    const service = createService({
      onAgentStarted: (handler) => {
        onAgentStarted = handler;
      },
    });
    const requestReconcile = vi.spyOn(service, 'requestReconcile').mockResolvedValue(undefined);
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await onAgentStarted?.({ chatroomId: 'room-1', role: 'builder' } as never);

    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    expect(requestReconcile).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      source: 'agent-started',
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
    const requestReconcile = vi.spyOn(service, 'requestReconcile').mockResolvedValue(undefined);
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    onSessionLost?.({ chatroomId: 'room-1', role: 'builder' } as never);

    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    expect(requestReconcile).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      source: 'operational-signal',
    });
    service.dispose();
  });

  test('routes task-signal and bootstrap notifications by affected role', async () => {
    const service = createService();
    const requestReconcile = vi.spyOn(service, 'requestReconcile').mockResolvedValue(undefined);
    const snapshot = {
      chatroomId: 'room-1',
      agentConfig: { role: 'builder' },
    } as never;

    await service.handleTaskInboxUpdate({
      signals: [],
      snapshots: [snapshot],
      afterSignalKey: 'a',
      throughSignalKey: 'b',
    });
    await service.handleTaskServiceNotification({ kind: 'bootstrap', snapshots: [snapshot] });

    expect(requestReconcile).toHaveBeenNthCalledWith(1, {
      chatroomId: 'room-1',
      role: 'builder',
      source: 'task-signal',
    });
    expect(requestReconcile).toHaveBeenNthCalledWith(2, {
      chatroomId: 'room-1',
      role: 'builder',
      source: 'bootstrap',
    });
    service.dispose();
  });

  test('coalesces duplicate role reconciliations and runs a fresh pass afterward', async () => {
    const service = createService();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reconcileRole = vi
      .spyOn(service as any, 'reconcileRole')
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

    expect(reconcileRole).toHaveBeenCalledTimes(2);
    expect(reconcileRole).toHaveBeenNthCalledWith(
      2,
      'operational-signal',
      expect.any(Array),
      undefined
    );
  });

  test('failed turn with an active task recovers the exact task before releasing the slot', async () => {
    const releaseTaskAfterTurnFailure = vi.fn(async () => ({
      released: true,
      status: 'pending' as const,
      updatedAt: 1700000000000,
    }));
    const enqueueFact = vi.fn(async () => undefined);
    const service = createService({ releaseTaskAfterTurnFailure, enqueueFact });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    const disposition = await service.handleAgentTurnEnded(failedTurnEvent() as never);

    expect(releaseTaskAfterTurnFailure).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-1',
    });
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    expect(disposition).toEqual({ kind: 'release-slot' });
    expect(enqueueFact).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn_failed', taskId: 'task-1', turnId: 'turn-1' })
    );
    service.dispose();
  });

  test('failed-turn recovery is awaited: disposition does not resolve before the backend call', async () => {
    let resolveRecovery!: (value: {
      released: boolean;
      status: 'pending';
      updatedAt: number;
    }) => void;
    const recovery = new Promise<{ released: boolean; status: 'pending'; updatedAt: number }>(
      (resolve) => {
        resolveRecovery = resolve;
      }
    );
    const releaseTaskAfterTurnFailure = vi.fn(() => recovery);
    const service = createService({ releaseTaskAfterTurnFailure });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    let settled = false;
    const pending = service.handleAgentTurnEnded(failedTurnEvent() as never).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(releaseTaskAfterTurnFailure).toHaveBeenCalled();
    expect(settled).toBe(false);
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeDefined();

    resolveRecovery({ released: true, status: 'pending', updatedAt: 1700000000000 });
    const disposition = await pending;

    expect(settled).toBe(true);
    expect(disposition).toEqual({ kind: 'release-slot' });
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    service.dispose();
  });

  test('failed-turn recovery rejection holds the slot and keeps active-task state', async () => {
    const releaseTaskAfterTurnFailure = vi.fn(async () => {
      throw new Error('backend unavailable');
    });
    const enqueueFact = vi.fn(async () => undefined);
    const service = createService({ releaseTaskAfterTurnFailure, enqueueFact });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    const disposition = await service.handleAgentTurnEnded(failedTurnEvent() as never);

    expect(disposition).toEqual({ kind: 'hold-slot', reason: 'task-recovery-failed' });
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toMatchObject({
      taskId: 'task-1',
    });
    expect(enqueueFact).not.toHaveBeenCalled();
    service.dispose();
  });

  test('failed turn with no active task records the fact and releases the slot', async () => {
    const releaseTaskAfterTurnFailure = vi.fn();
    const enqueueFact = vi.fn(async () => undefined);
    const service = createService({ releaseTaskAfterTurnFailure, enqueueFact });

    const disposition = await service.handleAgentTurnEnded(failedTurnEvent() as never);

    expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
    expect(enqueueFact).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'turn_failed', turnId: 'turn-1' })
    );
    expect(disposition).toEqual({ kind: 'release-slot' });
    service.dispose();
  });

  test('failed turn with no active task holds the slot when the fact enqueue fails', async () => {
    const enqueueFact = vi.fn(async () => {
      throw new Error('outbox down');
    });
    const service = createService({ enqueueFact });

    const disposition = await service.handleAgentTurnEnded(failedTurnEvent() as never);

    expect(disposition).toEqual({
      kind: 'hold-slot',
      reason: 'turn-failed-outbox-enqueue-failed',
    });
    service.dispose();
  });

  test('fact-enqueue failure after successful recovery still releases the slot', async () => {
    const releaseTaskAfterTurnFailure = vi.fn(async () => ({
      released: false,
      status: 'pending' as const,
      updatedAt: 1700000000000,
    }));
    const enqueueFact = vi.fn(async () => {
      throw new Error('outbox down');
    });
    const service = createService({ releaseTaskAfterTurnFailure, enqueueFact });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    const disposition = await service.handleAgentTurnEnded(failedTurnEvent() as never);

    expect(disposition).toEqual({ kind: 'release-slot' });
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    service.dispose();
  });
});
