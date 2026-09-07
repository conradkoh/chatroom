import { describe, expect, it, vi } from 'vitest';

import {
  createAgentProcessManagerService,
  type AgentProcessManagerCommand,
  type AgentProcessManagerExecutionPort,
} from './agent-process-manager-service.js';
import type {
  EnsureRunningOpts,
  StopOpts,
} from '../../../../infrastructure/services/agent-lifecycle/agent-lifecycle-types.js';
import { InMemoryCommandNotifier } from '../components/command-notifier/index.js';

function createExecution(events: string[]): AgentProcessManagerExecutionPort {
  return {
    runSerializedForAgent: async (_key, operation) => operation(),
    ensureRunning: vi.fn(async (input) => {
      events.push(`start:${input.chatroomId}:${input.role}`);
      return { success: true };
    }),
    stop: vi.fn(async (input) => {
      events.push(`stop:${input.chatroomId}:${input.role}`);
      return { success: true };
    }),
    handleExit: vi.fn(async () => undefined),
    reset: vi.fn(async () => undefined),
    getSlot: vi.fn(() => undefined),
    listActive: vi.fn(() => []),
    clearStuckStoppingSlot: vi.fn(async () => false),
    whenTurnEndsIdle: vi.fn(async () => undefined),
    resumeTurnForSlot: vi.fn(async () => undefined),
    subscribeAgentTurnEnded: () => () => undefined,
    subscribeAgentStarted: () => () => undefined,
  };
}

const startInput = (chatroomId: string, role: string) =>
  ({
    chatroomId,
    role,
    agentHarness: 'claude',
    workingDir: '/tmp/workspace',
    reason: 'test',
    wantResume: false,
  }) as unknown as EnsureRunningOpts;

const stopInput = (chatroomId: string, role: string) =>
  ({ chatroomId, role, reason: 'user.stop' }) as StopOpts;

async function waitForEventCount(events: string[], count: number): Promise<void> {
  await vi.waitFor(() => expect(events).toHaveLength(count), { timeout: 1_000 });
}

describe('AgentProcessManagerService', () => {
  it('purges queued commands and notifies their callers when reset is requested', async () => {
    const events: string[] = [];
    const notifier = new InMemoryCommandNotifier<AgentProcessManagerCommand>();
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      notifier,
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });
    const notifications: string[] = [];
    service.subscribe({}, (notification) => {
      notifications.push(`${notification.operationId}:${notification.status}`);
    });

    const pending = service.stopAgent(stopInput('room-1', 'builder'));
    const result = await service.reset({ scope: 'chatroom', chatroomId: 'room-1' });

    await expect(pending).rejects.toThrow('reset cancelled');
    expect(result.purgedMessageCount).toBe(1);
    expect(result.cancelledOperationIds).toHaveLength(1);
    expect(notifications).toEqual([`${result.cancelledOperationIds[0]}:cancelled`]);
    expect(events).toEqual([]);
  });

  it('resumes polling after resetting an active service', async () => {
    const events: string[] = [];
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      notifier: new InMemoryCommandNotifier(),
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });

    service.startProcessing();
    await service.reset({ scope: 'chatroom', chatroomId: 'room-1' });
    await expect(service.startAgent(startInput('room-1', 'builder'))).resolves.toMatchObject({
      status: 'succeeded',
    });
    await waitForEventCount(events, 1);
    await service.stopProcessing();

    expect(events).toEqual(['start:room-1:builder']);
  });

  it('leaves another chatroom queue intact during reset', async () => {
    const events: string[] = [];
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      notifier: new InMemoryCommandNotifier(),
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });

    const roomOne = service.stopAgent(stopInput('room-1', 'builder'));
    const roomTwo = service.stopAgent(stopInput('room-2', 'builder'));
    await service.reset({ scope: 'chatroom', chatroomId: 'room-1' });

    await expect(roomOne).rejects.toThrow('reset cancelled');
    service.startProcessing();
    await expect(roomTwo).resolves.toMatchObject({ status: 'succeeded' });
    await service.stopProcessing();

    expect(events).toEqual(['stop:room-2:builder']);
  });

  it('can reset one role without purging the other roles in the chatroom', async () => {
    const events: string[] = [];
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      notifier: new InMemoryCommandNotifier(),
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });

    const builder = service.stopAgent(stopInput('room-1', 'builder'));
    const reviewer = service.stopAgent(stopInput('room-1', 'reviewer'));
    await service.reset({ scope: 'chatroom-role', chatroomId: 'room-1', role: 'BUILDER' });

    await expect(builder).rejects.toThrow('reset cancelled');
    service.startProcessing();
    await expect(reviewer).resolves.toMatchObject({ status: 'succeeded' });
    await service.stopProcessing();

    expect(events).toEqual(['stop:room-1:reviewer']);
  });

  it('serializes a compound operation with lifecycle commands for the same agent key', async () => {
    const events: string[] = [];
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      notifier: new InMemoryCommandNotifier(),
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });

    service.startProcessing();
    const compound = service.runSerializedForAgent(
      { chatroomId: 'room-1', role: 'builder' },
      { timeoutMs: 1_000 },
      async (ops, context) => {
        await ops.stopAgent(stopInput('room-1', 'builder'), context.signal);
        await ops.startAgent(startInput('room-1', 'builder'), context.signal);
        return 'complete';
      }
    );
    const competing = service.stopAgent(stopInput('room-1', 'builder'));

    await expect(compound).resolves.toBe('complete');
    await expect(competing).resolves.toMatchObject({ status: 'succeeded' });
    service.stopProcessing();

    expect(events).toEqual(['stop:room-1:builder', 'start:room-1:builder', 'stop:room-1:builder']);
  });

  it('aborts a timed-out operation but holds the key until the operation settles', async () => {
    const events: string[] = [];
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      notifier: new InMemoryCommandNotifier(),
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });

    service.startProcessing();
    let aborted = false;
    const timedOut = service.runSerializedForAgent(
      { chatroomId: 'room-1', role: 'builder' },
      { timeoutMs: 10 },
      async (_ops, context) =>
        new Promise<void>((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true }
          );
        })
    );
    const competing = service.stopAgent(stopInput('room-1', 'builder'));

    await expect(timedOut).rejects.toThrow('timed out');
    await expect(competing).resolves.toMatchObject({ status: 'succeeded' });
    service.stopProcessing();

    expect(aborted).toBe(true);
    expect(events).toEqual(['stop:room-1:builder']);
  });

  it('rejects serialized operations without a positive timeout', async () => {
    const service = createAgentProcessManagerService({
      execution: createExecution([]),
      notifier: new InMemoryCommandNotifier(),
    });

    await expect(
      service.runSerializedForAgent(
        { chatroomId: 'room-1', role: 'builder' },
        { timeoutMs: 0 },
        async () => undefined
      )
    ).rejects.toThrow('timeout must be positive');
  });

  it('serializes lifecycle commands for the same agent key', async () => {
    const events: string[] = [];
    const notifications: string[] = [];
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      restartAgent: vi.fn(async () => undefined),
      notifier: new InMemoryCommandNotifier(),
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });

    service.subscribe({ messageGroupId: 'room-1:builder' }, (notification) => {
      notifications.push(`${notification.status}:${notification.messageId}`);
    });
    service.startProcessing();
    const startMessage = await service.startAgent(startInput('room-1', 'builder'));
    const stopMessage = await service.stopAgent(stopInput('room-1', 'builder'));
    await waitForEventCount(events, 2);
    await waitForEventCount(notifications, 2);
    service.stopProcessing();

    expect(events).toEqual(['start:room-1:builder', 'stop:room-1:builder']);
    expect(notifications).toEqual([
      `succeeded:${startMessage.messageId}`,
      `succeeded:${stopMessage.messageId}`,
    ]);
  });

  it('allows commands for different agent keys to be processed independently', async () => {
    const events: string[] = [];
    const service = createAgentProcessManagerService({
      execution: createExecution(events),
      restartAgent: vi.fn(async () => undefined),
      notifier: new InMemoryCommandNotifier(),
      consumer: { pollIntervalMs: 1, visibilityTimeoutMs: 100 },
    });

    service.startProcessing();
    await Promise.all([
      service.startAgent(startInput('room-1', 'builder')),
      service.startAgent(startInput('room-2', 'builder')),
    ]);
    await waitForEventCount(events, 2);
    service.stopProcessing();

    expect(events).toHaveLength(2);
    expect(events).toEqual(
      expect.arrayContaining(['start:room-1:builder', 'start:room-2:builder'])
    );
  });
});
