import { describe, expect, test, vi } from 'vitest';

import { createCliGatewayService } from './index.js';
import type { AssignedTask, AssignedTaskWithContent } from '../../domain/entities/assigned-task.js';

const inProgressTask: AssignedTask = {
  taskId: 'task-before',
  chatroomId: 'room-1',
  status: 'in_progress',
  assignedTo: 'planner',
  updatedAt: 2,
  createdAt: 1,
  agentConfig: { role: 'planner', machineId: 'machine-1' },
};

const nextTask: AssignedTaskWithContent = {
  taskId: 'task-next',
  chatroomId: 'room-1',
  status: 'pending',
  assignedTo: 'builder',
  updatedAt: 2,
  createdAt: 1,
  agentConfig: { role: 'builder', machineId: 'machine-1' },
  taskContent: 'next task',
};

function createService(result: Record<string, unknown>, events: string[]) {
  const listTasksForRole = vi.fn((): readonly AssignedTask[] => [inProgressTask]);
  const mutation = vi.fn(async () => {
    events.push('backend');
    return result;
  });
  const loadAssignedTaskForAction = vi.fn(async () => {
    events.push('load');
    return nextTask;
  });
  const recordHandoffOutcome = vi.fn(async () => {
    events.push('task-service');
  });
  const logs: string[] = [];
  const service = createCliGatewayService({
    backend: { mutation } as never,
    port: 18765,
    taskService: { loadAssignedTaskForAction, recordHandoffOutcome, listTasksForRole },
    log: (line) => logs.push(line),
  });
  return {
    service,
    mutation,
    loadAssignedTaskForAction,
    recordHandoffOutcome,
    listTasksForRole,
    logs,
  };
}

const args = {
  sessionId: 'session-1',
  chatroomId: 'room-1',
  senderRole: 'planner',
  content: 'handoff content',
  targetRole: 'builder',
};

describe('CLI gateway service', () => {
  test('updates task service and adopts the next task before resolving', async () => {
    const events: string[] = [];
    const { service, loadAssignedTaskForAction, recordHandoffOutcome, logs } = createService(
      { success: true, newTaskId: 'task-next' },
      events
    );

    await expect(service.handoff(args)).resolves.toMatchObject({ success: true });

    expect(service.debugState().port).toBe(18765);
    expect(events).toEqual(['backend', 'load', 'task-service']);
    expect(loadAssignedTaskForAction).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-next',
    });
    expect(recordHandoffOutcome).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'planner',
      targetRole: 'builder',
      nextTask,
      taskIds: ['task-before'],
    });
    expect(logs).toEqual([
      '[CliGateway:request handoff chatroom=room-1 role=planner]',
      '[CliGateway:backend result success=true]',
      '[CliGateway:task-service updated chatroom=room-1 role=planner adopted=task-next]',
    ]);
  });

  test('updates the sender task without loading a user handoff task', async () => {
    const events: string[] = [];
    const { service, loadAssignedTaskForAction, recordHandoffOutcome } = createService(
      { success: true, newTaskId: null },
      events
    );

    await service.handoff({ ...args, targetRole: 'user' });

    expect(loadAssignedTaskForAction).not.toHaveBeenCalled();
    expect(recordHandoffOutcome).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'planner',
      targetRole: 'user',
      nextTask: undefined,
      taskIds: ['task-before'],
    });
  });

  test('clears sender tasks and returns success when post-commit adoption fails', async () => {
    const events: string[] = [];
    const recordHandoffOutcome = vi.fn(async () => {
      events.push('task-service');
    });
    const logs: string[] = [];
    const service = createCliGatewayService({
      backend: {
        mutation: vi.fn(async () => ({ success: true, newTaskId: 'task-next' })),
      } as never,
      port: 18765,
      taskService: {
        loadAssignedTaskForAction: vi.fn(async () => {
          events.push('load');
          throw new Error('adoption failed');
        }),
        recordHandoffOutcome,
      },
      log: (line) => logs.push(line),
    });

    await expect(service.handoff(args)).resolves.toMatchObject({ success: true });
    expect(events).toEqual(['load', 'task-service']);
    expect(recordHandoffOutcome).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'planner',
      targetRole: 'builder',
    });
    expect(logs).toContain(
      '[CliGateway:post-commit sync failure chatroom=room-1 error=adoption failed]'
    );
  });

  test('does not resolve until durable handoff persistence completes', async () => {
    const events: string[] = [];
    let resolveDurable!: () => void;
    const durable = new Promise<void>((resolve) => {
      resolveDurable = resolve;
    });
    const service = createCliGatewayService({
      backend: { mutation: vi.fn(async () => ({ success: true, newTaskId: null })) } as never,
      port: 18765,
      taskService: {
        listTasksForRole: vi.fn((): readonly AssignedTask[] => [inProgressTask]),
        loadAssignedTaskForAction: vi.fn(),
        recordHandoffOutcome: vi.fn(() =>
          durable.then(() => {
            events.push('durable');
          })
        ),
      },
      log: () => undefined,
    });
    let settled = false;
    const pending = service.handoff({ ...args, targetRole: 'user' }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveDurable();
    await pending;
    expect(events).toEqual(['durable']);
  });

  test('returns success and logs post-commit failures when durable persistence rejects', async () => {
    const logs: string[] = [];
    const error = new Error('sqlite unavailable');
    const recordHandoffOutcome = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(new Error('cleanup unavailable'));
    const service = createCliGatewayService({
      backend: { mutation: vi.fn(async () => ({ success: true, newTaskId: null })) } as never,
      port: 18765,
      taskService: {
        listTasksForRole: vi.fn((): readonly AssignedTask[] => [inProgressTask]),
        loadAssignedTaskForAction: vi.fn(),
        recordHandoffOutcome,
      },
      log: (line) => logs.push(line),
    });
    await expect(service.handoff({ ...args, targetRole: 'user' })).resolves.toMatchObject({
      success: true,
    });
    expect(recordHandoffOutcome).toHaveBeenCalledTimes(2);
    expect(logs).toContain(
      '[CliGateway:post-commit sync failure chatroom=room-1 error=sqlite unavailable]'
    );
    expect(logs).toContain(
      '[CliGateway:post-commit cleanup failure chatroom=room-1 error=cleanup unavailable]'
    );
  });

  test('logs and rethrows backend failures', async () => {
    const error = new Error('backend unavailable');
    const logs: string[] = [];
    const service = createCliGatewayService({
      backend: { mutation: vi.fn(async () => Promise.reject(error)) } as never,
      port: 18765,
      taskService: {
        loadAssignedTaskForAction: vi.fn(),
        recordHandoffOutcome: vi.fn(),
      },
      log: (line) => logs.push(line),
    });

    await expect(service.handoff(args)).rejects.toBe(error);
    expect(logs).toEqual([
      '[CliGateway:request handoff chatroom=room-1 role=planner]',
      '[CliGateway:backend failure=backend unavailable]',
    ]);
  });
});
