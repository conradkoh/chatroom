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
        query: vi.fn().mockResolvedValueOnce([task]).mockResolvedValueOnce([]),
      },
    });

    await service.startTaskInbox();
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };
    await service.recordUncoveredTurnEnd(args);
    await service.recordUncoveredTurnEnd(args);
    await service.recordUncoveredTurnEnd(args);
    expect(service.isRedeliveryExhausted(args)).toBe(true);

    service.forgetStaleTask(args);
    service.forgetStaleTask(args);

    expect(service.listTasksForRole('room-1', 'builder')).toEqual([]);
    expect(service.debugState('room-1').tasks).toEqual([]);
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    service.stopTaskInbox();
  });

  test('bootstrap sweep releases uncovered in-progress tasks', async () => {
    const task = {
      taskId: 'task-in-progress',
      chatroomId: 'room-1',
      status: 'in_progress' as const,
      assignedTo: 'builder',
      updatedAt: 2_000,
      createdAt: 1_000,
      agentConfig: { role: 'builder', machineId: 'machine-1' },
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
        query: vi.fn().mockResolvedValueOnce([task]).mockResolvedValueOnce([]),
      },
    });

    await service.startTaskInbox();

    expect(repository.getLatest).toHaveBeenCalledWith('room-1', 'builder');
    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'task-in-progress' })
    );
    expect(service.listTasksForRole('room-1', 'builder')).toMatchObject([
      { taskId: 'task-in-progress', status: 'pending', updatedAt: 3_000 },
    ]);
  });

  test('bootstrap sweep leaves a handoff-covered in-progress task untouched', async () => {
    const task = {
      taskId: 'task-covered',
      chatroomId: 'room-1',
      status: 'in_progress' as const,
      assignedTo: 'builder',
      updatedAt: 2_000,
      createdAt: 1_000,
      agentConfig: { role: 'builder', machineId: 'machine-1' },
    };
    const mutation = vi.fn();
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
        query: vi.fn().mockResolvedValueOnce([task]).mockResolvedValueOnce([]),
      },
    });

    await service.startTaskInbox();

    expect(mutation).not.toHaveBeenCalled();
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
    const query = vi.fn().mockResolvedValueOnce([statusTask]).mockResolvedValueOnce([]);
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
    const query = vi.fn(async () => [event]);
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
    const query = vi.fn(async () => [event]);
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
      const query = vi.fn(async () => [event]);
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

    expect(await service.recordUncoveredTurnEnd(args)).toEqual({ exceeded: false });
    expect(await service.recordUncoveredTurnEnd(args)).toEqual({ exceeded: false });
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    expect(await service.recordUncoveredTurnEnd(args)).toEqual({ exceeded: true });
    expect(service.isRedeliveryExhausted(args)).toBe(true);

    // At the cap: failure recorded exactly once, further turns stay exhausted.
    const recordCalls = mutation.mock.calls.filter(
      ([, callArgs]) => (callArgs as { reason?: string }).reason === 'redelivery_exhausted'
    );
    expect(recordCalls).toHaveLength(1);
    expect(recordCalls[0][1]).toMatchObject({ taskId: 'task-1', reason: 'redelivery_exhausted' });
    expect(await service.recordUncoveredTurnEnd(args)).toEqual({ exceeded: true });
    expect(
      mutation.mock.calls.filter(
        ([, callArgs]) => (callArgs as { reason?: string }).reason === 'redelivery_exhausted'
      )
    ).toHaveLength(1);
  });

  test('a user-initiated agent restart resets the exhausted cycle', async () => {
    const mutation = vi.fn().mockResolvedValue({ recorded: true });
    const service = trackerService(mutation);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };
    await service.recordUncoveredTurnEnd(args);
    await service.recordUncoveredTurnEnd(args);
    await service.recordUncoveredTurnEnd(args);
    expect(service.isRedeliveryExhausted(args)).toBe(true);

    service.clearRedeliveryTracking({ chatroomId: 'room-1', role: 'builder' });
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    expect(await service.recordUncoveredTurnEnd(args)).toEqual({ exceeded: false });
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
      .mockResolvedValueOnce([event]); // bootstrap pending events
    const service = trackerService(mutation, query);
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-1' };
    await service.recordUncoveredTurnEnd(args);
    await service.recordUncoveredTurnEnd(args);
    await service.recordUncoveredTurnEnd(args);
    expect(service.isRedeliveryExhausted(args)).toBe(true);

    await service.startTaskInbox();
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    service.stopTaskInbox();
  });
});

describe('TaskService.handleAgentRestart', () => {
  function inboxService(task: Record<string, unknown>, mutation: ReturnType<typeof vi.fn>) {
    return createTaskService({
      sessionId: 'session-1',
      machineId: 'machine-1',
      convexUrl: 'http://test:3210',
      configurationService: { get: () => undefined } as never,
      handoffRepository: createInMemoryTaskHandoffRepository(),
      backend: {
        mutation,
        query: vi.fn().mockResolvedValueOnce([task]).mockResolvedValueOnce([]),
      },
    } as never);
  }

  test('releases the role in-flight tasks to pending and resets the redelivery cap', async () => {
    const task = {
      taskId: 'task-in-flight',
      chatroomId: 'room-1',
      status: 'in_progress' as const,
      assignedTo: 'builder',
      updatedAt: 2_000,
      createdAt: 1_000,
      agentConfig: { role: 'builder', machineId: 'machine-1' },
    };
    const mutation = vi.fn().mockResolvedValue({
      released: true,
      status: 'pending',
      updatedAt: 3_000,
    });
    const service = inboxService(task, mutation);

    await service.startTaskInbox();

    // Exhaust the V2 attempt cap first: a user-initiated restart resets it.
    const args = { chatroomId: 'room-1', role: 'builder', taskId: 'task-in-flight' };
    await service.recordUncoveredTurnEnd(args);
    await service.recordUncoveredTurnEnd(args);
    await service.recordUncoveredTurnEnd(args);
    expect(service.isRedeliveryExhausted(args)).toBe(true);

    await service.handleAgentRestart({ chatroomId: 'room-1', role: 'builder' });

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ taskId: 'task-in-flight' })
    );
    expect(service.listTasksForRole('room-1', 'builder')).toMatchObject([
      { taskId: 'task-in-flight', status: 'pending', updatedAt: 3_000 },
    ]);
    expect(service.isRedeliveryExhausted(args)).toBe(false);
    service.stopTaskInbox();
  });

  test('does not touch tasks of other roles', async () => {
    const task = {
      taskId: 'task-planner',
      chatroomId: 'room-1',
      status: 'acknowledged' as const,
      assignedTo: 'planner',
      updatedAt: 2_000,
      createdAt: 1_000,
      agentConfig: { role: 'planner', machineId: 'machine-1' },
    };
    const mutation = vi.fn().mockResolvedValue({
      released: true,
      status: 'pending',
      updatedAt: 3_000,
    });
    const service = inboxService(task, mutation);

    await service.startTaskInbox();

    await service.handleAgentRestart({ chatroomId: 'room-1', role: 'builder' });

    expect(mutation).not.toHaveBeenCalled();
    expect(service.listTasksForRole('room-1', 'planner')).toMatchObject([
      { taskId: 'task-planner', status: 'acknowledged' },
    ]);
    service.stopTaskInbox();
  });
});
