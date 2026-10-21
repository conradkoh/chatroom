import {
  WorkspaceTaskInboxEventStatus,
  WorkspaceTaskInboxEventType,
} from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { describe, expect, test, vi } from 'vitest';

import { createTaskService } from './task-service.js';
import { api } from '../../../../api.js';
import { TaskAssigneeType } from '../../../domain/entities/assigned-task.js';
import { createInMemoryTaskHandoffRepository } from '../infrastructure/repository/task-handoff-repository.js';

function backendRow() {
  return {
    taskId: 'task-1',
    chatroomId: 'room-1',
    status: 'pending' as const,
    assignedTo: 'user-1',
    updatedAt: 1000,
    createdAt: 900,
    agentConfig: {
      role: 'builder',
      machineId: 'machine-1',
      agentHarness: 'cursor-sdk',
      model: 'gpt-4',
      workingDir: '/tmp/ws',
    },
    taskContent: 'Do the thing',
  };
}

/** Mirrors TURN_FAILURE_RETRY_CAP in task-service.ts: eight provider failures park the task. */
const TURN_FAILURE_RETRY_CAP = 8;

/** Records failures until the cap is reached, returning the final result. */
async function exhaustTurnFailures(
  service: ReturnType<typeof createTaskService>,
  args: { chatroomId: string; role: string; taskId: string }
): Promise<{ attempts: number; exceeded: boolean }> {
  let result: { attempts: number; exceeded: boolean } = { attempts: 0, exceeded: false };
  for (let attempt = 1; attempt <= TURN_FAILURE_RETRY_CAP; attempt += 1) {
    result = await service.recordTurnFailure(args);
  }
  return result;
}

function activeTask(overrides: Record<string, unknown> = {}) {
  return {
    taskId: 'task-1',
    chatroomId: 'room-1',
    status: 'in_progress' as const,
    assignedTo: 'builder',
    updatedAt: 2_000,
    createdAt: 1_000,
    agentConfig: { role: 'builder', machineId: 'machine-1' },
    ...overrides,
  };
}

function recoveryService(
  {
    statuses,
    mutation = vi.fn(async () => ({ released: true, status: 'pending', updatedAt: 3_000 })),
    query = vi.fn(async () => statuses),
    handoffRepository = createInMemoryTaskHandoffRepository(),
  }: {
    statuses: readonly ReturnType<typeof activeTask>[];
    mutation?: ReturnType<typeof vi.fn>;
    query?: ReturnType<typeof vi.fn>;
    handoffRepository?:
      ReturnType<typeof createInMemoryTaskHandoffRepository> | Record<string, unknown>;
  } = { statuses: [] }
) {
  const service = createTaskService({
    sessionId: 'session-1',
    machineId: 'machine-1',
    convexUrl: 'http://test:3210',
    configurationService: { get: () => undefined } as never,
    handoffRepository: handoffRepository as never,
    backend: { mutation: mutation as never, query: query as never },
  });
  return { service, mutation, query, handoffRepository };
}

describe('TaskService.recoverInFlightTasks', () => {
  test('uses one machine status query and releases acknowledged and in-progress tasks absent locally', async () => {
    const statuses = [
      activeTask({ taskId: 'acknowledged', status: 'acknowledged' }),
      activeTask({ taskId: 'in-progress', status: 'in_progress' }),
    ];
    const { service, query, mutation } = recoveryService({ statuses });

    await expect(service.recoverInFlightTasks({ mode: 'automatic' })).resolves.toEqual({
      released: 2,
      skipped: 0,
    });

    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(api.daemon.taskStatus.listActive, {
      sessionId: 'session-1',
      machineId: 'machine-1',
    });
    expect(mutation.mock.calls).toEqual([
      [
        api.tasks.releaseTaskAfterTurnFailure,
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          role: 'builder',
          taskId: 'acknowledged',
        },
      ],
      [
        api.tasks.releaseTaskAfterTurnFailure,
        {
          sessionId: 'session-1',
          chatroomId: 'room-1',
          role: 'builder',
          taskId: 'in-progress',
        },
      ],
    ]);
    expect(query.mock.calls.map(([fn]) => fn)).toEqual([api.daemon.taskStatus.listActive]);
    service.stopTaskInbox();
  });

  test('filters statuses outside the machine, selected room, selected role, and in-flight states', async () => {
    const { service, mutation } = recoveryService({
      statuses: [
        activeTask({ taskId: 'pending', status: 'pending' }),
        activeTask({ taskId: 'completed', status: 'completed' }),
        activeTask({
          taskId: 'other-machine',
          agentConfig: { role: 'builder', machineId: 'machine-2' },
        }),
        activeTask({
          taskId: 'other-role',
          agentConfig: { role: 'reviewer', machineId: 'machine-1' },
          assignedTo: 'reviewer',
        }),
        activeTask({ taskId: 'wrong-assignee', assignedTo: 'reviewer' }),
        activeTask({ taskId: 'other-room', chatroomId: 'room-2' }),
        activeTask({
          taskId: 'selected',
          agentConfig: { role: 'Builder', machineId: 'machine-1' },
          assignedTo: 'BUILDER',
        }),
      ],
    });

    await expect(
      service.recoverInFlightTasks({ chatroomId: 'room-1', role: 'builder', mode: 'automatic' })
    ).resolves.toEqual({ released: 1, skipped: 6 });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation).toHaveBeenCalledWith(
      api.tasks.releaseTaskAfterTurnFailure,
      expect.objectContaining({ taskId: 'selected' })
    );
    service.stopTaskInbox();
  });

  test('automatic mode skips latest-handoff coverage and exhausted tasks', async () => {
    const repository = {
      getLatest: vi.fn(async () => ({ taskIds: ['covered'] })),
      close: vi.fn(),
      record: vi.fn(),
    };
    const { service, mutation } = recoveryService({
      statuses: [
        activeTask({ taskId: 'covered' }),
        activeTask({ taskId: 'exhausted' }),
        activeTask({ taskId: 'eligible' }),
      ],
      handoffRepository: repository,
    });
    const exhaustedArgs = { chatroomId: 'room-1', role: 'builder', taskId: 'exhausted' };
    await exhaustTurnFailures(service, exhaustedArgs);

    await expect(service.recoverInFlightTasks({ mode: 'automatic' })).resolves.toEqual({
      released: 1,
      skipped: 2,
    });
    expect(repository.getLatest).toHaveBeenCalledTimes(1);
    expect(
      mutation.mock.calls.filter(([, args]) => (args as { taskId?: string }).taskId === 'eligible')
    ).toHaveLength(1);
    expect(mutation).toHaveBeenCalledWith(
      api.tasks.releaseTaskAfterTurnFailure,
      expect.objectContaining({ taskId: 'eligible' })
    );
    service.stopTaskInbox();
  });

  test('explicit mode overrides handoff coverage and clears role redelivery tracking', async () => {
    const repository = {
      getLatest: vi.fn(async () => ({ taskIds: ['covered'] })),
      close: vi.fn(),
      record: vi.fn(),
    };
    const { service, mutation } = recoveryService({
      statuses: [activeTask({ taskId: 'covered' })],
      handoffRepository: repository,
    });
    const exhaustedArgs = { chatroomId: 'room-1', role: 'builder', taskId: 'covered' };
    await exhaustTurnFailures(service, exhaustedArgs);
    expect(service.isRedeliveryExhausted(exhaustedArgs)).toBe(true);

    await expect(
      service.recoverInFlightTasks({ chatroomId: 'room-1', role: 'BUILDER', mode: 'explicit' })
    ).resolves.toEqual({ released: 1, skipped: 0 });
    expect(service.isRedeliveryExhausted(exhaustedArgs)).toBe(false);
    expect(repository.getLatest).not.toHaveBeenCalled();
    expect(mutation).toHaveBeenCalledWith(
      api.tasks.releaseTaskAfterTurnFailure,
      expect.objectContaining({ taskId: 'covered' })
    );
    service.stopTaskInbox();
  });

  test('a newer local timestamp is not regressed by an older release response', async () => {
    const taskAtNewerTime = activeTask({ status: 'pending', updatedAt: 4_000 });
    const { service, query, mutation } = recoveryService({
      statuses: [activeTask({ updatedAt: 2_000 })],
      mutation: vi.fn(async () => ({ released: true, status: 'pending', updatedAt: 3_000 })),
      query: vi
        .fn()
        .mockResolvedValueOnce([taskAtNewerTime])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([activeTask({ updatedAt: 2_000 })]),
    });
    await service.startTaskInbox();
    await service.recoverInFlightTasks({ chatroomId: 'room-1', role: 'builder', mode: 'explicit' });
    expect(query).toHaveBeenCalledTimes(4);
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(service.listTasksForRole('room-1', 'builder')).toMatchObject([
      { taskId: 'task-1', status: 'pending', updatedAt: 4_000 },
    ]);
    service.stopTaskInbox();
  });

  test('read failure rejects and a retry performs a fresh read', async () => {
    const query = vi
      .fn()
      .mockRejectedValueOnce(new Error('read failed'))
      .mockResolvedValueOnce([activeTask()]);
    const { service, mutation } = recoveryService({ statuses: [], query });
    await expect(service.recoverInFlightTasks({ mode: 'automatic' })).rejects.toThrow(
      'read failed'
    );
    await expect(service.recoverInFlightTasks({ mode: 'automatic' })).resolves.toEqual({
      released: 1,
      skipped: 0,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(mutation).toHaveBeenCalledTimes(1);
    service.stopTaskInbox();
  });

  test('partial release failure rejects and retry rereads without regressing the first release', async () => {
    const statuses = [activeTask({ taskId: 'first' }), activeTask({ taskId: 'second' })];
    const query = vi.fn(async () => statuses);
    const mutation = vi
      .fn()
      .mockResolvedValueOnce({ released: true, status: 'pending', updatedAt: 3_000 })
      .mockRejectedValueOnce(new Error('release failed'))
      .mockResolvedValueOnce({ released: false, status: 'pending', updatedAt: 3_000 })
      .mockResolvedValueOnce({ released: true, status: 'pending', updatedAt: 4_000 });
    const { service } = recoveryService({ statuses, query, mutation });

    await expect(service.recoverInFlightTasks({ mode: 'automatic' })).rejects.toThrow(
      'release failed'
    );
    await expect(service.recoverInFlightTasks({ mode: 'automatic' })).resolves.toEqual({
      released: 1,
      skipped: 1,
    });
    expect(query).toHaveBeenCalledTimes(2);
    expect(
      mutation.mock.calls.map(([fn, args]) => [fn, (args as { taskId: string }).taskId])
    ).toEqual([
      [api.tasks.releaseTaskAfterTurnFailure, 'first'],
      [api.tasks.releaseTaskAfterTurnFailure, 'second'],
      [api.tasks.releaseTaskAfterTurnFailure, 'first'],
      [api.tasks.releaseTaskAfterTurnFailure, 'second'],
    ]);
    service.stopTaskInbox();
  });
});

describe('TaskService.listMachineTaskRolesForChatroom', () => {
  test('queries once and returns normalized distinct roles for assigned tasks on this machine and room', async () => {
    const { service, query, mutation } = recoveryService({
      statuses: [
        activeTask({
          agentConfig: { role: 'Builder', machineId: 'MACHINE-1' },
          assignedTo: 'builder',
        }),
        activeTask({
          taskId: 'duplicate',
          agentConfig: { role: 'BUILDER', machineId: 'machine-1' },
          assignedTo: 'BUILDER',
        }),
        activeTask({
          taskId: 'review',
          agentConfig: { role: 'Reviewer', machineId: 'machine-1' },
          assignedTo: 'REVIEWER',
        }),
        activeTask({
          taskId: 'other-room',
          chatroomId: 'room-2',
          agentConfig: { role: 'other', machineId: 'machine-1' },
          assignedTo: 'other',
        }),
        activeTask({
          taskId: 'other-machine',
          agentConfig: { role: 'remote', machineId: 'machine-2' },
          assignedTo: 'remote',
        }),
        activeTask({
          taskId: 'wrong-assignee',
          agentConfig: { role: 'builder', machineId: 'machine-1' },
          assignedTo: 'reviewer',
        }),
      ],
    });

    await expect(service.listMachineTaskRolesForChatroom('ROOM-1')).resolves.toEqual([
      'builder',
      'reviewer',
    ]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(api.daemon.taskStatus.listActive, {
      sessionId: 'session-1',
      machineId: 'machine-1',
    });
    expect(mutation).not.toHaveBeenCalled();
    service.stopTaskInbox();
  });

  test('propagates backend query failures', async () => {
    const query = vi.fn().mockRejectedValue(new Error('status query failed'));
    const { service, mutation } = recoveryService({ statuses: [], query });
    await expect(service.listMachineTaskRolesForChatroom('room-1')).rejects.toThrow(
      'status query failed'
    );
    expect(query).toHaveBeenCalledTimes(1);
    expect(mutation).not.toHaveBeenCalled();
    service.stopTaskInbox();
  });
});

describe('TaskService.loadAssignedTaskForAction', () => {
  test('returns null for a wrong-room row and the mapped task for the requested room', async () => {
    const query = vi.fn(async () => backendRow());
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      backend: { mutation: vi.fn(async () => undefined), query },
      agentProcessService: {
        getSlot: vi.fn(),
        resumeTurnForSlot: vi.fn(),
        runSerializedForAgent: vi.fn(),
      } as never,
      lifecycleOutbox: { enqueue: vi.fn(async () => undefined) },
    } as never);

    await expect(
      service.loadAssignedTaskForAction({
        chatroomId: 'different-room',
        role: 'builder',
        taskId: 'task-1',
      })
    ).resolves.toBeNull();

    await expect(
      service.loadAssignedTaskForAction({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      })
    ).resolves.toMatchObject({
      taskId: 'task-1',
      chatroomId: 'room-1',
      taskContent: 'Do the thing',
    });

    expect(query).toHaveBeenCalledTimes(2);
    expect(query).toHaveBeenCalledWith(api.machines.getAssignedTaskForAction, {
      sessionId: 'session-1',
      machineId: 'machine-1',
      taskId: 'task-1',
      role: 'builder',
    });
  });
});

describe('TaskService inbox consumption', () => {
  test('forgetStaleTask evicts local state and is idempotent', async () => {
    const task = backendRow();
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: createInMemoryTaskHandoffRepository(),
      backend: {
        mutation: vi.fn().mockResolvedValue({ processed: true }),
        query: vi
          .fn()
          .mockResolvedValueOnce([task])
          .mockResolvedValueOnce([])
          .mockResolvedValue([]),
      },
    });

    await service.startTaskInbox();
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };
    await exhaustTurnFailures(service, args);
    expect(service.isRedeliveryExhausted(args)).toBe(true);

    service.forgetStaleTask(args);
    service.forgetStaleTask(args);

    expect(service.listTasksForRole('room-1', 'builder')).toEqual([]);
    expect(service.debugState('room-1').tasks).toEqual([]);
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    service.stopTaskInbox();
  });

  test('bootstrap recovery releases authoritative acknowledged and in-progress tasks', async () => {
    const tasks = [
      activeTask({ taskId: 'task-acknowledged', status: 'acknowledged' }),
      activeTask({ taskId: 'task-in-progress', status: 'in_progress' }),
    ];
    const pendingEvent = {
      _id: 'event-after-recovery',
      machineId: 'machine-1',
      chatroomId: 'room-1',
      taskId: 'task-acknowledged',
      role: 'builder',
      eventType: WorkspaceTaskInboxEventType.TaskAssigned,
      status: WorkspaceTaskInboxEventStatus.Pending,
      createdAt: 3_000,
      task: {
        taskId: 'task-acknowledged',
        chatroomId: 'room-1',
        status: 'pending',
        assignedTo: 'builder',
        updatedAt: 3_000,
        createdAt: 1_000,
        startInNewSession: false,
      },
    };
    const mutation = vi.fn().mockResolvedValue({
      released: true,
      status: 'pending',
      updatedAt: 3_000,
    });
    const repository = {
      record: vi.fn(),
      getLatest: vi.fn().mockResolvedValue(null),
      close: vi.fn(),
    };
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: repository,
      backend: {
        mutation,
        // Startup's first snapshot is empty; automatic recovery must find the
        // backend-only in-flight rows through its authoritative read.
        query: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(tasks)
          .mockResolvedValueOnce([pendingEvent]),
      },
    });
    const deliveredTaskIds: string[] = [];
    service.subscribe((notification) => {
      if (notification.kind !== 'inbox-event') return;
      deliveredTaskIds.push(notification.event.taskId);
      return { handledEventIds: [notification.event.eventId] };
    });

    await service.startTaskInbox();

    expect(repository.getLatest).toHaveBeenCalledWith('room-1', 'builder');
    expect(
      mutation.mock.calls
        .filter(([, args]) => typeof args === 'object' && args !== null && 'role' in args)
        .map(([, args]) => (args as { taskId: string }).taskId)
    ).toEqual(['task-acknowledged', 'task-in-progress']);
    expect(deliveredTaskIds).toEqual(['task-acknowledged']);
    expect(service.listTasksForRole('room-1', 'builder')).toMatchObject([
      { taskId: 'task-acknowledged', status: 'pending' },
    ]);
  });

  test('bootstrap recovery leaves a handoff-covered in-progress task untouched', async () => {
    const task = {
      taskId: 'task-covered',
      chatroomId: 'room-1',
      status: 'in_progress' as const,
      assignedTo: 'builder',
      updatedAt: 2_000,
      createdAt: 1_000,
      agentConfig: { role: 'builder', machineId: 'machine-1' },
    };
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const repository = {
      record: vi.fn(),
      getLatest: vi.fn().mockResolvedValue({ taskIds: ['task-covered'] }),
      close: vi.fn(),
    };
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: repository,
      backend: {
        mutation,
        query: vi
          .fn()
          .mockResolvedValueOnce([task])
          .mockResolvedValueOnce([task])
          .mockResolvedValue([]),
      },
    });

    await service.startTaskInbox();

    expect(
      mutation.mock.calls.filter(
        ([, args]) => typeof args === 'object' && args !== null && 'role' in args
      )
    ).toHaveLength(0);
    expect(service.listTasksForRole('room-1', 'builder')).toMatchObject([
      { taskId: 'task-covered', status: 'in_progress' },
    ]);
  });

  test('rehydrates a pending task from the authoritative status feed', async () => {
    const statusTask = {
      taskId: 'task-rehydrated',
      chatroomId: 'room-1',
      status: 'pending',
      assignedTo: 'builder',
      updatedAt: 2_000,
      createdAt: 1_000,
      agentConfig: { role: 'builder', machineId: 'machine-1' },
    };
    const query = vi
      .fn()
      .mockResolvedValueOnce([statusTask])
      .mockResolvedValueOnce([])
      .mockResolvedValue([]);
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: createInMemoryTaskHandoffRepository(),
      backend: { mutation: vi.fn(async () => ({ processed: true })), query },
    });

    await service.startTaskInbox();

    expect(service.listTasksForRole('room-1', 'builder')).toMatchObject([
      { taskId: 'task-rehydrated', status: 'pending', updatedAt: 2_000 },
    ]);
    service.stopTaskInbox();
  });

  test('bootstrap recovery keeps handoff-covered and V2 exhausted tasks parked', async () => {
    const tasks = [activeTask({ taskId: 'covered' }), activeTask({ taskId: 'exhausted' })];
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const repository = {
      record: vi.fn(),
      getLatest: vi.fn().mockResolvedValue({ taskIds: ['covered'] }),
      close: vi.fn(),
    };
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: repository,
      backend: {
        mutation,
        query: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(tasks).mockResolvedValue([]),
      },
    });
    const exhaustedArgs = { chatroomId: 'room-1', role: 'builder', taskId: 'exhausted' };
    await exhaustTurnFailures(service, exhaustedArgs);

    await service.startTaskInbox();

    expect(repository.getLatest).toHaveBeenCalledWith('room-1', 'builder');
    expect(
      mutation.mock.calls.filter(
        ([, args]) => typeof args === 'object' && args !== null && 'role' in args
      )
    ).toHaveLength(0);
    service.stopTaskInbox();
  });

  test('bootstrap recovery retries a transient status read failure with backoff', async () => {
    vi.useFakeTimers();
    try {
      const task = activeTask({ taskId: 'backend-only' });
      const query = vi
        .fn()
        .mockRejectedValueOnce(new Error('initial status read failure'))
        .mockRejectedValueOnce(new Error('temporary recovery read failure'))
        .mockResolvedValueOnce([]) // pending inbox events
        .mockResolvedValueOnce([task])
        .mockResolvedValue([]);
      const mutation = vi
        .fn()
        .mockResolvedValue({ released: true, status: 'pending', updatedAt: 3_000 });
      const { service } = recoveryService({ statuses: [], query, mutation });

      await service.startTaskInbox();
      expect(query).toHaveBeenCalledTimes(3);
      expect(mutation).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(999);
      expect(query).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);

      expect(query).toHaveBeenCalledTimes(4);
      expect(mutation).toHaveBeenCalledWith(
        api.tasks.releaseTaskAfterTurnFailure,
        expect.objectContaining({ taskId: 'backend-only' })
      );
      service.stopTaskInbox();
    } finally {
      vi.useRealTimers();
    }
  });

  test('bootstrap recovery retries a transient release failure and cancels retry on stop', async () => {
    vi.useFakeTimers();
    try {
      const task = activeTask({ taskId: 'release-retry' });
      const query = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([task])
        .mockResolvedValue([]);
      const mutation = vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary release failure'))
        .mockResolvedValue({ released: true, status: 'pending', updatedAt: 3_000 });
      const { service } = recoveryService({ statuses: [], query, mutation });

      await service.startTaskInbox();
      expect(mutation).toHaveBeenCalledTimes(1);
      expect(query).toHaveBeenCalledTimes(3);
      service.stopTaskInbox();

      await vi.advanceTimersByTimeAsync(30_000);
      expect(query).toHaveBeenCalledTimes(3);
      expect(mutation).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  test('status reconciliation joins an in-flight bootstrap retry', async () => {
    vi.useFakeTimers();
    try {
      let resolveRetry: ((tasks: readonly ReturnType<typeof activeTask>[]) => void) | undefined;
      const query = vi
        .fn()
        .mockResolvedValueOnce([]) // initial status snapshot
        .mockRejectedValueOnce(new Error('temporary read failure'))
        .mockResolvedValueOnce([]) // pending inbox events
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveRetry = resolve;
            })
        );
      let onStatusUpdate: ((tasks: readonly ReturnType<typeof activeTask>[]) => void) | undefined;
      const wsClient = {
        onUpdate: vi.fn((queryRef, _args, callback) => {
          if (queryRef === api.daemon.taskStatus.listActive) {
            onStatusUpdate = callback as typeof onStatusUpdate;
          }
          return vi.fn();
        }),
      } as never;
      const { service } = recoveryService({ statuses: [], query });

      await service.startTaskInbox(wsClient);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(query).toHaveBeenCalledTimes(3);

      onStatusUpdate?.([activeTask()]);
      expect(query).toHaveBeenCalledTimes(3);

      resolveRetry?.([]);
      await Promise.resolve();
      service.stopTaskInbox();
    } finally {
      vi.useRealTimers();
    }
  });

  test('keeps a permanent assignment visible when no agent slot exists yet', async () => {
    const event = {
      _id: 'event-permanent-1',
      machineId: 'machine-1',
      chatroomId: 'room-1',
      taskId: 'task-1',
      role: 'builder',
      assignee: { type: TaskAssigneeType.Permanent },
      eventType: WorkspaceTaskInboxEventType.TaskAssigned,
      status: WorkspaceTaskInboxEventStatus.Pending,
      createdAt: 1_000,
      task: {
        taskId: 'task-1',
        chatroomId: 'room-1',
        status: 'pending',
        assignedTo: 'builder',
        updatedAt: 1_000,
        createdAt: 900,
        startInNewSession: false,
      },
    } as never;
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([event]);
    const mutation = vi.fn(async () => ({ processed: true }));
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: createInMemoryTaskHandoffRepository(),
      backend: { mutation, query },
    });
    const notifications: unknown[] = [];
    service.subscribe((notification) => {
      notifications.push(notification);
    });

    await service.startTaskInbox();

    expect(service.listTasksForRole('room-1', 'builder')).toHaveLength(1);
    expect(notifications).toHaveLength(1);
    expect(mutation).not.toHaveBeenCalledWith(
      api.chatroomWorkspaceTaskInbox.markProcessed,
      expect.objectContaining({ eventId: 'event-permanent-1' })
    );
    service.stopTaskInbox();
  });

  test('hydrates task state from pending inbox events and acknowledges them', async () => {
    const event = {
      _id: 'event-1',
      machineId: 'machine-1',
      chatroomId: 'room-1',
      taskId: 'task-1',
      role: 'builder',
      assignee: {
        type: TaskAssigneeType.Ephemeral,
        ephemeral: {
          agentHarness: 'cursor-sdk',
          model: 'gpt-4',
          workingDir: '/tmp/ws',
        },
      },
      eventType: WorkspaceTaskInboxEventType.TaskAssigned,
      status: WorkspaceTaskInboxEventStatus.Pending,
      createdAt: 1_000,
      task: {
        taskId: 'task-1',
        chatroomId: 'room-1',
        status: 'pending',
        assignedTo: 'builder',
        updatedAt: 1_000,
        createdAt: 900,
        startInNewSession: false,
      },
    } as never;
    const query = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValue([event]);
    const mutation = vi.fn(async () => ({ processed: true }));
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: createInMemoryTaskHandoffRepository(),
      backend: { mutation, query },
      agentProcessService: {
        getSlot: vi.fn(),
        resumeTurnForSlot: vi.fn(),
        runSerializedForAgent: vi.fn(),
      } as never,
      lifecycleOutbox: { enqueue: vi.fn(async () => undefined) },
    } as never);

    await service.startTaskInbox();

    expect(service.listTasksForRole('room-1', 'builder')).toMatchObject([
      {
        taskId: 'task-1',
        chatroomId: 'room-1',
        status: 'pending',
        agentConfig: {
          role: 'builder',
          machineId: 'machine-1',
        },
        assignee: {
          type: TaskAssigneeType.Ephemeral,
          ephemeral: {
            agentHarness: 'cursor-sdk',
            model: 'gpt-4',
            workingDir: '/tmp/ws',
          },
        },
      },
    ]);
    expect(mutation).toHaveBeenCalledTimes(0);
    service.stopTaskInbox();
  });

  test('header-only pending event is acknowledged once and a later snapshot without it does not re-acknowledge', async () => {
    const event = {
      _id: 'event-header-1',
      machineId: 'machine-1',
      chatroomId: 'room-1',
      taskId: 'task-1',
      role: 'builder',
      eventType: WorkspaceTaskInboxEventType.TaskAssigned,
      status: WorkspaceTaskInboxEventStatus.Pending,
      createdAt: 1_000,
      task: {
        taskId: 'task-1',
        chatroomId: 'room-1',
        status: 'pending',
        assignedTo: 'builder',
        createdAt: 900,
        updatedAt: 1_000,
        startInNewSession: false,
      },
    } as never;
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([]);
    const mutation = vi.fn(async () => ({ processed: true }));
    const service = createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: createInMemoryTaskHandoffRepository(),
      backend: { mutation, query },
    });
    const notifications: unknown[] = [];
    service.subscribe((notification) => {
      notifications.push(notification);
      return {
        handledEventIds: notification.kind === 'inbox-event' ? [notification.event.eventId] : [],
      };
    });
    let captured: ((rows: readonly unknown[]) => void) | undefined;
    const wsClient = {
      onUpdate: vi.fn((_queryRef, _args, callback) => {
        // `startTaskInbox` subscribes to the pending inbox before the task-status
        // stream, so the first captured callback is the inbox snapshot.
        captured ??= callback as typeof captured;
        return () => {};
      }),
    };

    await service.startTaskInbox(wsClient as never);
    captured?.([event]);
    await vi.waitFor(() => {
      expect(mutation).toHaveBeenCalledWith(
        api.chatroomWorkspaceTaskInbox.markProcessed,
        expect.objectContaining({ eventId: 'event-header-1' })
      );
    });

    expect(notifications).toHaveLength(1);
    expect(service.listTasksForRole('room-1', 'builder')).toHaveLength(1);
    expect(mutation).toHaveBeenCalledTimes(1);

    captured?.([]);
    await Promise.resolve();

    expect(mutation).toHaveBeenCalledTimes(1);
    expect(notifications).toHaveLength(1);
    service.stopTaskInbox();
  });

  test('retries acknowledgement without redelivering the event', async () => {
    vi.useFakeTimers();
    try {
      const event = {
        _id: 'event-ack-retry',
        machineId: 'machine-1',
        chatroomId: 'room-1',
        taskId: 'task-1',
        role: 'builder',
        eventType: WorkspaceTaskInboxEventType.TaskAssigned,
        status: WorkspaceTaskInboxEventStatus.Pending,
        createdAt: 1_000,
        task: {
          taskId: 'task-1',
          chatroomId: 'room-1',
          status: 'pending',
          assignedTo: 'builder',
          updatedAt: 1_000,
          createdAt: 900,
          startInNewSession: false,
        },
      } as never;
      const query = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValue([event]);
      const mutation = vi
        .fn()
        .mockRejectedValueOnce(new Error('transient acknowledgement failure'))
        .mockResolvedValue({ processed: true });
      const service = createTaskService({
        sessionId: 'session-1',
        machineId: 'machine-1',
        convexUrl: 'http://test:3210',
        backend: { mutation, query },
        configurationService: { get: () => undefined } as never,
        handoffRepository: createInMemoryTaskHandoffRepository(),
      });
      const notifications: unknown[] = [];
      service.subscribe((notification) => {
        notifications.push(notification);
        return {
          handledEventIds: notification.kind === 'inbox-event' ? [notification.event.eventId] : [],
        };
      });

      await service.startTaskInbox();
      await vi.advanceTimersByTimeAsync(1_000);

      expect(notifications).toHaveLength(1);
      expect(mutation).toHaveBeenCalledTimes(2);
      service.stopTaskInbox();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TaskService redelivery attempt cap (plan V2)', () => {
  function trackerService(mutation: ReturnType<typeof vi.fn>, query?: ReturnType<typeof vi.fn>) {
    return createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: createInMemoryTaskHandoffRepository(),
      backend: { mutation, query: query ?? vi.fn().mockResolvedValue([]) },
    } as never);
  }

  test('caps consecutive uncovered turn ends and records the failure once', async () => {
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const service = trackerService(mutation);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };

    for (let attempt = 1; attempt < TURN_FAILURE_RETRY_CAP; attempt += 1) {
      expect(await service.recordTurnFailure(args)).toEqual({ attempts: attempt, exceeded: false });
    }
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    expect(await service.recordTurnFailure(args)).toEqual({
      attempts: TURN_FAILURE_RETRY_CAP,
      exceeded: true,
    });
    expect(service.isRedeliveryExhausted(args)).toBe(true);

    // At the cap: failure recorded exactly once, further turns stay exhausted.
    const recordCalls = mutation.mock.calls.filter(
      ([, callArgs]) => (callArgs as { reason?: string }).reason === 'redelivery_exhausted'
    );
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0][1]).toMatchObject({ taskId: 'task-1', reason: 'redelivery_exhausted' });
    expect(await service.recordTurnFailure(args)).toEqual({
      attempts: TURN_FAILURE_RETRY_CAP,
      exceeded: true,
    });
    expect(
      mutation.mock.calls.filter(
        ([, callArgs]) => (callArgs as { reason?: string }).reason === 'redelivery_exhausted'
      )
    ).toHaveLength(1);
  });

  test('a burst of three failures no longer parks the task under the raised cap', async () => {
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const service = trackerService(mutation);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };

    // The production incident spent the old cap of three inside 2-9 seconds while
    // the provider was still failing. Three failures must now leave the task live.
    expect(await service.recordTurnFailure(args)).toEqual({ attempts: 1, exceeded: false });
    expect(await service.recordTurnFailure(args)).toEqual({ attempts: 2, exceeded: false });
    expect(await service.recordTurnFailure(args)).toEqual({ attempts: 3, exceeded: false });

    expect(service.isRedeliveryExhausted(args)).toBe(false);
    expect(
      mutation.mock.calls.filter(
        ([, callArgs]) => (callArgs as { reason?: string }).reason === 'redelivery_exhausted'
      )
    ).toHaveLength(0);
  });

  test('a user-initiated agent restart resets the exhausted cycle', async () => {
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const service = trackerService(mutation);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };
    await exhaustTurnFailures(service, args);
    expect(service.isRedeliveryExhausted(args)).toBe(true);

    service.clearRedeliveryTracking({ chatroomId: 'room-1', role: 'builder' });
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    expect(await service.recordTurnFailure(args)).toEqual({ attempts: 1, exceeded: false });
  });

  test('a completed inbox event clears tracking for the task', async () => {
    const task = backendRow();
    const completed = { ...task, status: 'completed', updatedAt: 2_000 };
    const event = {
      _id: 'event-1',
      machineId: 'machine-1',
      chatroomId: 'room-1',
      taskId: 'task-1',
      role: 'builder',
      eventType: WorkspaceTaskInboxEventType.TaskUpdated,
      status: WorkspaceTaskInboxEventStatus.Pending,
      createdAt: 2_000,
      task: completed,
    } as never;
    const mutation = vi.fn(async () => ({ processed: true }));
    const query = vi
      .fn()
      .mockResolvedValueOnce([]) // bootstrap status feed
      .mockResolvedValueOnce([]) // automatic recovery status feed
      .mockResolvedValueOnce([event]); // bootstrap pending events
    const service = trackerService(mutation, query);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };
    await exhaustTurnFailures(service, args);
    expect(service.isRedeliveryExhausted(args)).toBe(true);

    await service.startTaskInbox();
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    service.stopTaskInbox();
  });

  const redeliveryExhaustedWrites = (mutation: ReturnType<typeof vi.fn>) =>
    mutation.mock.calls.filter(
      ([, callArgs]) => (callArgs as { reason?: string }).reason === 'redelivery_exhausted'
    );

  test('ladder: nudge, restart, then nudge again for a new session, then park once', async () => {
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const service = trackerService(mutation);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };

    expect(await service.decideUncoveredTurnEnd({ ...args, sessionKey: '1:a' })).toEqual({
      action: 'nudge',
    });
    service.confirmNudgeSent({ ...args, sessionKey: '1:a' });
    expect(await service.decideUncoveredTurnEnd({ ...args, sessionKey: '1:a' })).toEqual({
      action: 'restart-session',
    });
    expect(await service.decideUncoveredTurnEnd({ ...args, sessionKey: '2:b' })).toEqual({
      action: 'nudge',
    });
    service.confirmNudgeSent({ ...args, sessionKey: '2:b' });
    expect(await service.decideUncoveredTurnEnd({ ...args, sessionKey: '2:b' })).toEqual({
      action: 'park',
    });
    expect(service.isRedeliveryExhausted(args)).toBe(true);
    expect(redeliveryExhaustedWrites(mutation)).toHaveLength(1);

    // Further decisions stay parked and do not write the failure again.
    expect(await service.decideUncoveredTurnEnd({ ...args, sessionKey: '3:c' })).toEqual({
      action: 'park',
    });
    expect(redeliveryExhaustedWrites(mutation)).toHaveLength(1);
  });

  test('ladder: nudge unavailable with no entry restarts the session, never nudges', async () => {
    const service = trackerService(vi.fn().mockResolvedValue({ recorded: true }));
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };

    expect(
      await service.decideUncoveredTurnEnd({ ...args, sessionKey: '1:a', nudgeUnavailable: true })
    ).toEqual({ action: 'restart-session' });
  });

  test('ladder: a decision clears the failure counter, so one later failure does not park', async () => {
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const service = trackerService(mutation);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };

    await service.recordTurnFailure(args);
    await service.recordTurnFailure(args);
    expect(await service.decideUncoveredTurnEnd({ ...args, sessionKey: '1:a' })).toEqual({
      action: 'nudge',
    });
    expect(await service.recordTurnFailure(args)).toEqual({ attempts: 1, exceeded: false });
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    expect(redeliveryExhaustedWrites(mutation)).toHaveLength(0);
  });

  test('ladder: failures do not change the nudge state, and three failures park via the failure path', async () => {
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const service = trackerService(mutation);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };

    service.confirmNudgeSent({ ...args, sessionKey: '1:a' });
    await service.recordTurnFailure(args);
    await service.recordTurnFailure(args);
    // The nudge key survived the failures: the same session restarts rather than nudging.
    expect(await service.decideUncoveredTurnEnd({ ...args, sessionKey: '1:a' })).toEqual({
      action: 'restart-session',
    });

    for (let attempt = 1; attempt < TURN_FAILURE_RETRY_CAP; attempt += 1) {
      expect(await service.recordTurnFailure(args)).toEqual({ attempts: attempt, exceeded: false });
    }
    expect(await service.recordTurnFailure(args)).toEqual({
      attempts: TURN_FAILURE_RETRY_CAP,
      exceeded: true,
    });
    expect(service.isRedeliveryExhausted(args)).toBe(true);
    expect(redeliveryExhaustedWrites(mutation)).toHaveLength(1);
  });

  test('resetTurnTracking clears the ladder and failure counter but keeps the parked marker', async () => {
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const service = trackerService(mutation);
    const counted = { chatroomId: 'room-1', role: 'builder', taskId: 'counted' };
    const nudged = { chatroomId: 'room-1', role: 'builder', taskId: 'nudged' };
    const parked = { chatroomId: 'room-1', role: 'builder', taskId: 'parked' };

    await service.recordTurnFailure(counted);
    await service.recordTurnFailure(counted);
    service.resetTurnTracking(counted);
    expect(await service.recordTurnFailure(counted)).toEqual({ attempts: 1, exceeded: false });

    service.confirmNudgeSent({ ...nudged, sessionKey: '1:a' });
    service.resetTurnTracking(nudged);
    expect(await service.decideUncoveredTurnEnd({ ...nudged, sessionKey: '1:a' })).toEqual({
      action: 'nudge',
    });

    await exhaustTurnFailures(service, parked);
    service.resetTurnTracking(parked);
    expect(service.isRedeliveryExhausted(parked)).toBe(true);
  });

  test('clearRedeliveryTracking clears the ladder and parked marker for that role only', async () => {
    const service = trackerService(vi.fn().mockResolvedValue({ recorded: true }));
    const builderNudged = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };
    const builderParked = { chatroomId: 'room-1', role: 'builder', taskId: 'task-2' };
    const plannerNudged = { chatroomId: 'room-1', role: 'planner', taskId: 'task-3' };

    service.confirmNudgeSent({ ...builderNudged, sessionKey: '1:a' });
    await exhaustTurnFailures(service, builderParked);
    service.confirmNudgeSent({ ...plannerNudged, sessionKey: '1:a' });

    service.clearRedeliveryTracking({ chatroomId: 'room-1', role: 'builder' });

    expect(await service.decideUncoveredTurnEnd({ ...builderNudged, sessionKey: '1:a' })).toEqual({
      action: 'nudge',
    });
    expect(service.isRedeliveryExhausted(builderParked)).toBe(false);
    expect(await service.decideUncoveredTurnEnd({ ...plannerNudged, sessionKey: '1:a' })).toEqual({
      action: 'restart-session',
    });
  });

  test('a daemon-authored pending TaskUpdated does not clear the ladder', async () => {
    const task = backendRow();
    const released = { ...task, status: 'pending', updatedAt: 2_000 };
    const event = {
      _id: 'event-1',
      machineId: 'machine-1',
      chatroomId: 'room-1',
      taskId: 'task-1',
      role: 'builder',
      eventType: WorkspaceTaskInboxEventType.TaskUpdated,
      status: WorkspaceTaskInboxEventStatus.Pending,
      createdAt: 2_000,
      task: released,
    } as never;
    const mutation = vi.fn(async () => ({ processed: true }));
    const query = vi
      .fn()
      .mockResolvedValueOnce([]) // bootstrap status feed
      .mockResolvedValueOnce([]) // automatic recovery status feed
      .mockResolvedValueOnce([event]); // bootstrap pending events
    const service = trackerService(mutation, query);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };
    service.confirmNudgeSent({ ...args, sessionKey: '1:a' });

    await service.startTaskInbox();
    service.stopTaskInbox();

    expect(await service.decideUncoveredTurnEnd({ ...args, sessionKey: '1:a' })).toEqual({
      action: 'restart-session',
    });
  });
});
