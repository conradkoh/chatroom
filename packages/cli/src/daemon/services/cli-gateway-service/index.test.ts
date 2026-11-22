import { describe, expect, test, vi } from 'vitest';

import { createCliGatewayService, snapshotSenderAgent } from './index.js';
import type { AssignedTask, AssignedTaskWithContent } from '../../domain/entities/assigned-task.js';

type ResolveSenderAgent = Parameters<typeof createCliGatewayService>[0]['resolveSenderAgent'];

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

function createService(
  result: Record<string, unknown>,
  events: string[],
  overrides: { resolveSenderAgent?: ResolveSenderAgent } = {}
) {
  const listTasksForRole = vi.fn((): readonly AssignedTask[] => [inProgressTask]);
  const mutation = vi.fn(async (_endpoint: unknown, _args: unknown) => {
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
    resolveSenderAgent: overrides.resolveSenderAgent ?? (() => undefined),
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
  test('passes attachedFileIds through to the backend mutation unchanged', async () => {
    const events: string[] = [];
    const { service, mutation } = createService({ success: true, newTaskId: null }, events);

    await service.handoff({ ...args, targetRole: 'user', attachedFileIds: ['file-a', 'file-b'] });

    expect(mutation.mock.calls[0]?.[1]).toMatchObject({
      targetRole: 'user',
      attachedFileIds: ['file-a', 'file-b'],
    });
  });

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
      resolveSenderAgent: () => undefined,
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
      resolveSenderAgent: () => undefined,
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
      resolveSenderAgent: () => undefined,
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
      resolveSenderAgent: () => undefined,
      log: (line) => logs.push(line),
    });

    await expect(service.handoff(args)).rejects.toBe(error);
    expect(logs).toEqual([
      '[CliGateway:request handoff chatroom=room-1 role=planner]',
      '[CliGateway:backend failure=backend unavailable]',
    ]);
  });
});

describe('sender agent snapshot', () => {
  const claude = { harness: 'claude-sdk', model: 'anthropic/claude-sonnet-4' };

  test('sends the running slot harness and model to the backend', async () => {
    const resolveSenderAgent = vi.fn(() => claude);
    const { service, mutation } = createService({ success: true, newTaskId: null }, [], {
      resolveSenderAgent,
    });

    await service.handoff({ ...args, targetRole: 'user' });

    expect(resolveSenderAgent).toHaveBeenCalledWith('room-1', 'planner');
    expect(mutation.mock.calls[0]?.[1]).toMatchObject({ senderAgent: claude });
  });

  test('sends a harness-only snapshot when the slot has no model', async () => {
    const { service, mutation } = createService({ success: true, newTaskId: null }, [], {
      resolveSenderAgent: () => ({ harness: 'codex-sdk' }),
    });

    await service.handoff({ ...args, targetRole: 'user' });

    expect((mutation.mock.calls[0]?.[1] as { senderAgent: unknown }).senderAgent).toStrictEqual({
      harness: 'codex-sdk',
    });
  });

  test('omits senderAgent entirely when the resolver returns undefined', async () => {
    const { service, mutation } = createService({ success: true, newTaskId: null }, []);

    await service.handoff({ ...args, targetRole: 'user' });

    expect(mutation.mock.calls[0]?.[1]).not.toHaveProperty('senderAgent');
  });

  test('strips a client-supplied senderAgent when the daemon has no snapshot', async () => {
    const { service, mutation } = createService({ success: true, newTaskId: null }, []);

    await service.handoff({
      ...args,
      targetRole: 'user',
      senderAgent: { harness: 'opencode-sdk', model: 'spoofed' },
    } as never);

    expect(mutation.mock.calls[0]?.[1]).not.toHaveProperty('senderAgent');
  });

  test('overwrites a client-supplied senderAgent with the daemon snapshot', async () => {
    const { service, mutation } = createService({ success: true, newTaskId: null }, [], {
      resolveSenderAgent: () => claude,
    });

    await service.handoff({
      ...args,
      targetRole: 'user',
      senderAgent: { harness: 'opencode-sdk', model: 'spoofed' },
    } as never);

    expect(mutation.mock.calls[0]?.[1]).toMatchObject({ senderAgent: claude });
  });

  test('still completes the handoff when the resolver throws', async () => {
    const logs: string[] = [];
    const mutation = vi.fn(async (_endpoint: unknown, _args: unknown) => ({
      success: true,
      newTaskId: null,
    }));
    const service = createCliGatewayService({
      backend: { mutation } as never,
      port: 18765,
      taskService: {
        listTasksForRole: vi.fn((): readonly AssignedTask[] => []),
        loadAssignedTaskForAction: vi.fn(),
        recordHandoffOutcome: vi.fn(async () => undefined),
      },
      resolveSenderAgent: () => {
        throw new Error('resolver down');
      },
      log: (line) => logs.push(line),
    });

    await expect(service.handoff({ ...args, targetRole: 'user' })).resolves.toMatchObject({
      success: true,
    });
    expect(mutation).toHaveBeenCalledTimes(1);
    expect(mutation.mock.calls[0]?.[1]).not.toHaveProperty('senderAgent');
    expect(logs).toContain(
      '[CliGateway:sender-agent unavailable chatroom=room-1 role=planner error=resolver down]'
    );
  });
});

describe('snapshotSenderAgent', () => {
  test('maps a running slot harness and model', () => {
    expect(
      snapshotSenderAgent({ harness: 'claude-sdk', model: 'anthropic/claude-sonnet-4' })
    ).toStrictEqual({
      harness: 'claude-sdk',
      model: 'anthropic/claude-sonnet-4',
    });
  });
  test('omits model when the slot has none', () => {
    expect(snapshotSenderAgent({ harness: 'codex-sdk', model: undefined })).toStrictEqual({
      harness: 'codex-sdk',
    });
  });
  test('returns undefined when the slot has no harness (idle or never started)', () => {
    expect(snapshotSenderAgent({ harness: undefined, model: 'm' })).toBeUndefined();
    expect(snapshotSenderAgent(undefined)).toBeUndefined();
  });
});
