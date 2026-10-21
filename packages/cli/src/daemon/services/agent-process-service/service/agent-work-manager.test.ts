import { AgentStartReasonCode } from '@workspace/backend/src/domain/entities/agent.js';
import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { AgentWorkManager } from './agent-work-manager.js';
import type { AgentLifecycleFact } from '../../../domain/entities/agent-lifecycle-fact.js';
import type { AssignedTask } from '../../../domain/entities/assigned-task.js';
import { TaskInboxState } from '../../../infrastructure/inbox/task-inbox-state.js';
import {
  createAgentLifecycleOutboxRegistry,
  agentLifecycleKey,
} from '../../../infrastructure/outbox/agent-lifecycle-outbox.js';
import { computeBackoffDelay } from '../../task-service/domain/usecase/compute-backoff-delay.js';
import { getRoleDeliveryState } from '../../task-service/service/native-delivery/role-delivery-state.js';
import { NativeTaskDeliveryQueue } from '../../task-service/service/native-task-delivery-queue.js';
import { createAgentTaskStateService } from '../index.js';

function createService(
  options: {
    readonly onTurnEnded?: (handler: (event: never) => Promise<unknown>) => void;
    readonly onAgentStarted?: (handler: (event: never) => Promise<unknown>) => void;
    readonly onSessionLost?: (handler: (event: never) => void) => void;
    readonly onTurnProgress?: (handler: (event: never) => void) => void;
    readonly releaseTaskAfterTurnFailure?: (
      args: Record<string, string>
    ) => Promise<{ released: boolean; status: 'pending'; updatedAt: number }>;
    readonly recordTurnFailure?: (
      args: Record<string, string>
    ) => Promise<{ attempts: number; exceeded: boolean }>;
    readonly isRedeliveryExhausted?: () => boolean;
    readonly clearRedeliveryTracking?: () => void;
    readonly markTurnFailureReleasePending?: ReturnType<typeof vi.fn>;
    readonly clearTurnFailureReleasePending?: ReturnType<typeof vi.fn>;
    readonly forgetStaleTask?: ReturnType<typeof vi.fn>;
    readonly loadAssignedTaskForAction?: (args: Record<string, string>) => Promise<unknown>;
    readonly initialTasks?: readonly AssignedTask[];
    readonly taskInboxState?: TaskInboxState;
    readonly getLatestHandoff?: () => Promise<{ taskIds: readonly string[] } | null>;
    readonly enqueueFact?: (fact: Record<string, unknown>) => Promise<unknown>;
    readonly getSlot?: () =>
      | {
          state: 'running' | 'idle' | 'spawning' | 'stopping';
          pid?: number;
          harnessSessionId?: string;
          nativeTurnPhase?: string;
        }
      | undefined;
    readonly resumeTurnForSlot?: (args: unknown) => Promise<unknown>;
    readonly decideUncoveredTurnEnd?: ReturnType<typeof vi.fn>;
    readonly confirmNudgeSent?: ReturnType<typeof vi.fn>;
    readonly resetTurnTracking?: ReturnType<typeof vi.fn>;
    readonly startAgent?: ReturnType<typeof vi.fn>;
    readonly runSerializedForAgent?: ReturnType<typeof vi.fn>;
    readonly agentConfig?: { agentHarness: string; model: string; workingDir: string };
    readonly isStopRequested?: () => boolean;
    readonly acquireNativeDeliverySlot?: ReturnType<typeof vi.fn>;
    readonly recordDeliveryFailure?: ReturnType<typeof vi.fn>;
    readonly stopAgent?: ReturnType<typeof vi.fn>;
    readonly recoverInFlightTasks?: ReturnType<typeof vi.fn>;
  } = {}
): AgentWorkManager {
  const taskInboxState = options.taskInboxState ?? new TaskInboxState();
  taskInboxState.upsert(options.initialTasks ?? []);
  return new AgentWorkManager({
    configurationService: { get: () => options.agentConfig } as never,
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
      subscribeAgentTurnProgress: (handler: (event: never) => void) => {
        options.onTurnProgress?.(handler);
        return () => undefined;
      },
      getSlot: options.getSlot ?? (() => undefined),
      isStopRequested: options.isStopRequested ?? (() => false),
      resumeTurnForSlot: (args: unknown) =>
        Effect.promise(() => (options.resumeTurnForSlot ?? (async () => undefined))(args)),
    } as never,
    runSerializedForAgent: (options.runSerializedForAgent ??
      (async (_key: never, _options: never, operation: any) =>
        operation(
          {
            startAgent: options.startAgent ?? vi.fn(async () => ({ success: true })),
            stopAgent: options.stopAgent ?? vi.fn(async () => ({ success: true })),
          },
          { signal: new AbortController().signal }
        ))) as never,
    acquireNativeDeliverySlot: (options.acquireNativeDeliverySlot ??
      vi.fn().mockResolvedValue({ state: 'running' })) as never,
    sessionDeps: {} as never,
    machineId: 'machine-1',
    taskInboxState,
    agentTaskState: createAgentTaskStateService(),
    lifecycleOutbox: { enqueue: (options.enqueueFact ?? (async () => undefined)) as never },
    taskService: {
      subscribe: () => () => undefined,
      startTaskInbox: async () => undefined,
      stopTaskInbox: () => undefined,
      listTasksForRole: () => [],
      listAllTasks: () => [],
      taskInboxState,
      isNativeHarness: () => true,
      loadAssignedTaskForAction:
        options.loadAssignedTaskForAction ??
        (async ({ taskId }: { taskId: string }) => ({ taskId })),
      forgetStaleTask: options.forgetStaleTask ?? vi.fn(),
      recordDeliveryFailure: options.recordDeliveryFailure ?? vi.fn(),
      clearDeliveryFailure: vi.fn(async () => true),
      getLatestHandoff: options.getLatestHandoff ?? (async () => null),
      recoverInFlightTasks:
        options.recoverInFlightTasks ?? (async () => ({ released: 0, skipped: 0 })),
      releaseTaskAfterTurnFailure: (options.releaseTaskAfterTurnFailure ??
        (async () => ({ released: true, status: 'pending', updatedAt: Date.now() }))) as never,
      recordTurnFailure:
        options.recordTurnFailure ?? (async () => ({ attempts: 1, exceeded: false })),
      decideUncoveredTurnEnd:
        options.decideUncoveredTurnEnd ?? (async () => ({ action: 'nudge' as const })),
      confirmNudgeSent: options.confirmNudgeSent ?? vi.fn(),
      resetTurnTracking: options.resetTurnTracking ?? vi.fn(),
      isRedeliveryExhausted: options.isRedeliveryExhausted ?? (() => false),
      clearRedeliveryTracking: options.clearRedeliveryTracking ?? (() => undefined),
      markTurnFailureReleasePending: options.markTurnFailureReleasePending ?? vi.fn(),
      clearTurnFailureReleasePending: options.clearTurnFailureReleasePending ?? vi.fn(),
      explainNativeDeliveryBlock: () => null,
    } as never,
  });
}

function pendingTask(taskId: string, role = 'builder'): AssignedTask {
  return {
    taskId,
    chatroomId: 'room-1',
    status: 'pending',
    assignedTo: role,
    updatedAt: 1,
    createdAt: 1,
    agentConfig: { role, machineId: 'machine-1' },
  } as AssignedTask;
}

function inProgressTask(taskId: string, role = 'builder'): AssignedTask {
  return { ...pendingTask(taskId, role), status: 'in_progress' } as AssignedTask;
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

function completedTurnEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chatroomId: 'room-1',
    role: 'builder',
    pid: 42,
    harness: 'opencode-sdk',
    slot: { state: 'running', harnessSessionId: 'sess-1', nativeTurnPhase: 'turn_in_flight' },
    eventId: 'turn-1',
    completion: { turnId: 'turn-1', status: 'completed', source: 'provider.result' },
    ...overrides,
  };
}

/** Lets the out-of-band nudge timer (setTimeout 0) and its async send run to completion. */
const flushTimers = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 10));

const runningSlot = () => ({ state: 'running' as const, pid: 42, harnessSessionId: 'sess-1' });

describe('AgentWorkManager', () => {
  test('releases a completed turn while a previous lifecycle send is blocked', async () => {
    const machineId = `test-turn-outbox-${Date.now()}-${Math.random()}`;
    const send = vi.fn(() => new Promise<{ success: true }>(() => {}));
    const registry = createAgentLifecycleOutboxRegistry(machineId, () => send);
    const enqueue = (fact: AgentLifecycleFact) =>
      registry.enqueue(agentLifecycleKey(machineId, fact), fact);
    await enqueue({
      kind: 'spawned',
      chatroomId: 'room-1',
      role: 'builder',
      pid: 42,
      emittedAt: Date.now(),
      revisionKey: 'spawn:1',
    });
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    const service = createService({
      enqueueFact: (fact) => enqueue(fact as AgentLifecycleFact),
      getLatestHandoff: async () => ({ taskIds: ['task-1'] }),
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
    const disposition = await service.handleAgentTurnEnded(
      failedTurnEvent({
        completion: { turnId: 'turn-1', status: 'completed', source: 'provider.result' },
      }) as never
    );
    expect(disposition).toEqual({ kind: 'release-slot' });
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    service.dispose();
    await registry.stopAll();
  });

  test('releases a completed turn even if its projection cannot be persisted', async () => {
    const service = createService({
      enqueueFact: async () => {
        throw new Error('disk full');
      },
    });
    const disposition = await service.handleAgentTurnEnded(
      failedTurnEvent({
        completion: { turnId: 'turn-1', status: 'completed', source: 'provider.result' },
      }) as never
    );
    expect(disposition).toEqual({ kind: 'release-slot' });
    service.dispose();
  });
  test('an uncovered completed turn never releases the task and keeps its active state until the nudge', async () => {
    const releaseTaskAfterTurnFailure = vi.fn();
    const decideUncoveredTurnEnd = vi.fn(async () => ({ action: 'nudge' as const }));
    const resumeTurnForSlot = vi.fn(async () => undefined);
    const service = createService({
      initialTasks: [pendingTask('task-1')],
      releaseTaskAfterTurnFailure,
      decideUncoveredTurnEnd,
      resumeTurnForSlot,
      getSlot: runningSlot,
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    const disposition = await service.handleAgentTurnEnded(completedTurnEvent() as never);

    expect(disposition).toEqual({ kind: 'release-slot' });
    expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
    expect(decideUncoveredTurnEnd).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'task-1', sessionKey: '42:sess-1' })
    );
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toEqual(
      expect.objectContaining({ taskId: 'task-1' })
    );
    // The nudge is scheduled out of band, never sent during the handler.
    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    service.dispose();
  });

  test('sends one nudge naming the task, and commits it only after the send resolves', async () => {
    const resumeTurnForSlot = vi.fn(async () => undefined);
    const confirmNudgeSent = vi.fn();
    const service = createService({
      initialTasks: [pendingTask('task-1')],
      resumeTurnForSlot,
      confirmNudgeSent,
      getSlot: runningSlot,
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await vi.waitFor(() => expect(resumeTurnForSlot).toHaveBeenCalledTimes(1));
    await flushTimers();

    expect(resumeTurnForSlot).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'room-1',
        role: 'builder',
        prompt: expect.stringContaining('task-1'),
      })
    );
    expect(confirmNudgeSent).toHaveBeenCalledTimes(1);
    expect(confirmNudgeSent).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-1',
      sessionKey: '42:sess-1',
    });
    service.dispose();
  });

  test('a nudge commits nothing when the delivery mutex is busy', async () => {
    const resumeTurnForSlot = vi.fn(async () => undefined);
    const confirmNudgeSent = vi.fn();
    const service = createService({
      initialTasks: [pendingTask('task-1')],
      resumeTurnForSlot,
      confirmNudgeSent,
      getSlot: runningSlot,
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
    const deliveryState = getRoleDeliveryState();
    expect(deliveryState.tryAcquireDelivery('room-1', 'builder')).toBe(true);
    try {
      await service.handleAgentTurnEnded(completedTurnEvent() as never);
      await flushTimers();
    } finally {
      deliveryState.releaseDelivery('room-1', 'builder');
    }

    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(confirmNudgeSent).not.toHaveBeenCalled();
    service.dispose();
  });

  test('a nudge commits nothing when the harness session changed before the send', async () => {
    const resumeTurnForSlot = vi.fn(async () => undefined);
    const confirmNudgeSent = vi.fn();
    const service = createService({
      initialTasks: [pendingTask('task-1')],
      resumeTurnForSlot,
      confirmNudgeSent,
      getSlot: () => ({ state: 'running', pid: 43, harnessSessionId: 'sess-1' }),
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await flushTimers();

    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(confirmNudgeSent).not.toHaveBeenCalled();
    service.dispose();
  });

  test('a nudge commits nothing when the slot is not idle before the send', async () => {
    const resumeTurnForSlot = vi.fn(async () => undefined);
    const confirmNudgeSent = vi.fn();
    const service = createService({
      initialTasks: [pendingTask('task-1')],
      resumeTurnForSlot,
      confirmNudgeSent,
      getSlot: () => ({
        state: 'running',
        pid: 42,
        harnessSessionId: 'sess-1',
        nativeTurnPhase: 'turn_in_flight',
      }),
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await flushTimers();

    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(confirmNudgeSent).not.toHaveBeenCalled();
    service.dispose();
  });

  test('a throwing nudge escalates with nudgeUnavailable and parks the task', async () => {
    const decideUncoveredTurnEnd = vi.fn(async (args: { nudgeUnavailable?: boolean }) =>
      args.nudgeUnavailable ? { action: 'park' as const } : { action: 'nudge' as const }
    );
    const confirmNudgeSent = vi.fn();
    const service = createService({
      initialTasks: [pendingTask('task-1')],
      resumeTurnForSlot: vi.fn(async () => {
        throw new Error('send failed');
      }),
      decideUncoveredTurnEnd,
      confirmNudgeSent,
      getSlot: runningSlot,
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await vi.waitFor(() => expect(decideUncoveredTurnEnd).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined()
    );

    expect(decideUncoveredTurnEnd).toHaveBeenLastCalledWith(
      expect.objectContaining({ nudgeUnavailable: true, sessionKey: '42:sess-1' })
    );
    expect(confirmNudgeSent).not.toHaveBeenCalled();
    service.dispose();
  });

  test('a park decision clears the active task, schedules delivery, and sends no nudge', async () => {
    const releaseTaskAfterTurnFailure = vi.fn();
    const resumeTurnForSlot = vi.fn(async () => undefined);
    const service = createService({
      initialTasks: [pendingTask('task-1')],
      releaseTaskAfterTurnFailure,
      resumeTurnForSlot,
      decideUncoveredTurnEnd: vi.fn(async () => ({ action: 'park' as const })),
      getSlot: runningSlot,
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
    const scheduleRoleDelivery = vi.spyOn(service as never, 'scheduleRoleDelivery');

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await flushTimers();

    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    expect(scheduleRoleDelivery).toHaveBeenCalledWith('room-1', 'builder');
    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
    service.dispose();
  });

  const restartConfig = { agentHarness: 'opencode-sdk', model: 'model-1', workingDir: '/work' };

  test('a restart-session decision stops, recovers, and starts in the order prepare, stop, recover, start', async () => {
    const calls: string[] = [];
    const runSerializedForAgent = vi.fn(async (_key: unknown, _opts: unknown, operation: any) =>
      operation(
        {
          stopAgent: async (input: { reason: string; pid: number }) => {
            calls.push(`stop:${input.reason}:${input.pid}`);
            return { success: true };
          },
          startAgent: async (input: { reason: string; wantResume: boolean }) => {
            calls.push(`start:${input.reason}:${input.wantResume}`);
            return { success: true };
          },
        },
        { signal: new AbortController().signal }
      )
    );
    const service = createService({
      runSerializedForAgent,
      agentConfig: restartConfig,
      getSlot: runningSlot,
      decideUncoveredTurnEnd: vi.fn(async () => ({ action: 'restart-session' as const })),
      initialTasks: [pendingTask('task-1')],
    });
    const internals = service as unknown as {
      prepareRoleRecovery(args: unknown): Promise<void>;
      recoverStoppedRole(args: unknown): Promise<{ released: number }>;
    };
    vi.spyOn(internals, 'prepareRoleRecovery').mockImplementation(async () => {
      calls.push('prepare');
    });
    vi.spyOn(internals, 'recoverStoppedRole').mockImplementation(async (args: unknown) => {
      calls.push(`recover:${(args as { mode: string }).mode}`);
      return { released: 1 };
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await vi.waitFor(() => expect(calls).toHaveLength(4));
    await flushTimers();

    expect(calls).toEqual([
      'prepare',
      'stop:daemon.respawn:42',
      'recover:automatic',
      'start:daemon.respawn:false',
    ]);
    expect(runSerializedForAgent).toHaveBeenCalledTimes(1);
    expect(runSerializedForAgent).toHaveBeenCalledWith(
      expect.objectContaining({ chatroomId: 'room-1', role: 'builder' }),
      { timeoutMs: 120_000 },
      expect.any(Function)
    );
    service.dispose();
  });

  test('a restart-session decision clears active state through prepare and sends no nudge', async () => {
    const resumeTurnForSlot = vi.fn(async () => undefined);
    const service = createService({
      agentConfig: restartConfig,
      getSlot: runningSlot,
      resumeTurnForSlot,
      decideUncoveredTurnEnd: vi.fn(async () => ({ action: 'restart-session' as const })),
      initialTasks: [pendingTask('task-1')],
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await vi.waitFor(() =>
      expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined()
    );
    await flushTimers();

    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    service.dispose();
  });

  test('a restart does nothing when the slot changed before the serialized section ran', async () => {
    const stopAgent = vi.fn(async () => ({ success: true }));
    const startAgent = vi.fn(async () => ({ success: true }));
    const service = createService({
      agentConfig: restartConfig,
      getSlot: () => ({ state: 'running', pid: 43, harnessSessionId: 'sess-1' }),
      stopAgent,
      startAgent,
      decideUncoveredTurnEnd: vi.fn(async () => ({ action: 'restart-session' as const })),
      initialTasks: [pendingTask('task-1')],
    });
    const scheduleRecoveryRetry = vi.spyOn(service as never, 'scheduleRecoveryRetry');
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await flushTimers();

    expect(stopAgent).not.toHaveBeenCalled();
    expect(startAgent).not.toHaveBeenCalled();
    expect(scheduleRecoveryRetry).not.toHaveBeenCalled();
    service.dispose();
  });

  test('a restart does nothing when a stop was requested before the serialized section ran', async () => {
    const stopAgent = vi.fn(async () => ({ success: true }));
    const startAgent = vi.fn(async () => ({ success: true }));
    const service = createService({
      agentConfig: restartConfig,
      getSlot: runningSlot,
      isStopRequested: () => true,
      stopAgent,
      startAgent,
      decideUncoveredTurnEnd: vi.fn(async () => ({ action: 'restart-session' as const })),
      initialTasks: [pendingTask('task-1')],
    });
    const scheduleRecoveryRetry = vi.spyOn(service as never, 'scheduleRecoveryRetry');
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await flushTimers();

    expect(stopAgent).not.toHaveBeenCalled();
    expect(startAgent).not.toHaveBeenCalled();
    expect(scheduleRecoveryRetry).not.toHaveBeenCalled();
    service.dispose();
  });

  test('a rejected start is logged, never re-runs the ladder, and does not throw', async () => {
    const decideUncoveredTurnEnd = vi.fn(async () => ({ action: 'restart-session' as const }));
    const service = createService({
      agentConfig: restartConfig,
      getSlot: runningSlot,
      startAgent: vi.fn(async () => ({ success: false, error: 'rate_limited' })),
      decideUncoveredTurnEnd,
      initialTasks: [pendingTask('task-1')],
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await expect(service.handleAgentTurnEnded(completedTurnEvent() as never)).resolves.toEqual({
      kind: 'release-slot',
    });
    await flushTimers();

    expect(decideUncoveredTurnEnd).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  test('a stop failure inside the restart keeps the recovery gate and schedules a retry without throwing', async () => {
    const decideUncoveredTurnEnd = vi.fn(async () => ({ action: 'restart-session' as const }));
    const service = createService({
      agentConfig: restartConfig,
      getSlot: runningSlot,
      stopAgent: vi.fn(async () => {
        throw new Error('stop failed');
      }),
      decideUncoveredTurnEnd,
      initialTasks: [pendingTask('task-1')],
    });
    const scheduleRecoveryRetry = vi.spyOn(service as never, 'scheduleRecoveryRetry');
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await expect(service.handleAgentTurnEnded(completedTurnEvent() as never)).resolves.toEqual({
      kind: 'release-slot',
    });
    await vi.waitFor(() => expect(scheduleRecoveryRetry).toHaveBeenCalledWith('room-1', 'builder'));

    expect(decideUncoveredTurnEnd).toHaveBeenCalledTimes(1);
    service.dispose();
  });

  test('a park decision sends no nudge and no restart', async () => {
    const stopAgent = vi.fn(async () => ({ success: true }));
    const runSerializedForAgent = vi.fn();
    const resumeTurnForSlot = vi.fn(async () => undefined);
    const service = createService({
      agentConfig: restartConfig,
      getSlot: runningSlot,
      stopAgent,
      runSerializedForAgent,
      resumeTurnForSlot,
      decideUncoveredTurnEnd: vi.fn(async () => ({ action: 'park' as const })),
      initialTasks: [pendingTask('task-1')],
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleAgentTurnEnded(completedTurnEvent() as never);
    await flushTimers();

    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(stopAgent).not.toHaveBeenCalled();
    expect(runSerializedForAgent).not.toHaveBeenCalled();
    service.dispose();
  });

  test('a failed turn records a failure, never consults the ladder, and defers the release', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const recordTurnFailure = vi.fn(async () => ({ attempts: 1, exceeded: false }));
      const decideUncoveredTurnEnd = vi.fn();
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        recordTurnFailure,
        releaseTaskAfterTurnFailure,
        decideUncoveredTurnEnd,
        taskInboxState: inbox,
      });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      await service.handleAgentTurnEnded(failedTurnEvent() as never);

      expect(recordTurnFailure).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });
      expect(decideUncoveredTurnEnd).not.toHaveBeenCalled();
      // The turn-ended handler no longer releases inline.
      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(4_999);
      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(1);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('the second failure waits the second backoff delay, not the first', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const recordTurnFailure = vi
        .fn()
        .mockResolvedValueOnce({ attempts: 1, exceeded: false })
        .mockResolvedValueOnce({ attempts: 2, exceeded: false });
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        recordTurnFailure,
        releaseTaskAfterTurnFailure,
        taskInboxState: inbox,
      });

      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await service.handleAgentTurnEnded(failedTurnEvent() as never);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(1);

      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await service.handleAgentTurnEnded(
        failedTurnEvent({
          eventId: 'turn-2',
          completion: {
            turnId: 'turn-2',
            status: 'failed',
            source: 'provider.transport',
            error: 'boom',
          },
        }) as never
      );

      await vi.advanceTimersByTimeAsync(9_999);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(2);
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('applies the cap to failed turns without a covering handoff and cancels the last timer', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      let attempts = 0;
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        releaseTaskAfterTurnFailure,
        recordTurnFailure: async () => ({ attempts: ++attempts, exceeded: attempts >= 8 }),
        taskInboxState: inbox,
      });

      for (let attempt = 1; attempt <= 8; attempt += 1) {
        service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
        await service.handleAgentTurnEnded(failedTurnEvent() as never);
      }

      expect(attempts).toBe(8);
      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      // The 7th failure armed a timer; parking at the 8th must cancel it.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('releases on the documented schedule before parking the eighth failure', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const startedAt = Date.now();
      const releaseTimes: number[] = [];
      const releaseTaskAfterTurnFailure = vi.fn(async () => {
        releaseTimes.push(Date.now() - startedAt);
        return { released: true, status: 'pending' as const, updatedAt: Date.now() };
      });
      let attempts = 0;
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        releaseTaskAfterTurnFailure,
        recordTurnFailure: async () => ({ attempts: ++attempts, exceeded: attempts >= 8 }),
        taskInboxState: inbox,
      });

      for (let attempt = 1; attempt <= 8; attempt += 1) {
        service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
        await service.handleAgentTurnEnded(failedTurnEvent() as never);
        if (attempt < 8) {
          await vi.advanceTimersByTimeAsync(computeBackoffDelay(attempt, () => 0.5));
        }
      }

      // Cumulative release times with neutral jitter: 5s, then +10s, +20s, +40s,
      // +80s, +160s, +300s. The eighth failure parks and schedules nothing.
      expect(releaseTimes).toEqual([5_000, 15_000, 35_000, 75_000, 155_000, 315_000, 615_000]);
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('cancels a waiting release when the task is deleted', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({ releaseTaskAfterTurnFailure, taskInboxState: inbox });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await service.handleAgentTurnEnded(failedTurnEvent() as never);

      await service.handleTaskServiceNotification({
        kind: 'inbox-event',
        event: {
          eventType: 'task_deleted',
          eventId: 'event-deleted',
          chatroomId: 'room-1',
          role: 'builder',
          taskId: 'task-1',
          task: inProgressTask('task-1'),
        },
      } as never);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('a new task assigned to the role does not cancel the superseded task release', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const markTurnFailureReleasePending = vi.fn();
      const clearTurnFailureReleasePending = vi.fn();
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        releaseTaskAfterTurnFailure,
        markTurnFailureReleasePending,
        clearTurnFailureReleasePending,
        taskInboxState: inbox,
      });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await service.handleAgentTurnEnded(failedTurnEvent() as never);

      await service.handleTaskServiceNotification({
        kind: 'inbox-event',
        event: {
          eventType: 'task_assigned',
          eventId: 'event-assigned',
          chatroomId: 'room-1',
          role: 'builder',
          taskId: 'task-2',
          task: pendingTask('task-2'),
        },
      } as never);

      // task-1 is superseded but still in flight, so its release must still fire.
      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(5_000);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(1);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });
      expect(clearTurnFailureReleasePending).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('a TaskAssigned for the same task id cancels that task waiting release', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const clearTurnFailureReleasePending = vi.fn();
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        releaseTaskAfterTurnFailure,
        clearTurnFailureReleasePending,
        taskInboxState: inbox,
      });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await service.handleAgentTurnEnded(failedTurnEvent() as never);
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      await service.handleTaskServiceNotification({
        kind: 'inbox-event',
        event: {
          eventType: 'task_assigned',
          eventId: 'event-reassigned',
          chatroomId: 'room-1',
          role: 'builder',
          taskId: 'task-1',
          task: pendingTask('task-1'),
        },
      } as never);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      expect(clearTurnFailureReleasePending).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('does not release when the task is the role active task when the timer fires', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({ releaseTaskAfterTurnFailure, taskInboxState: inbox });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await service.handleAgentTurnEnded(failedTurnEvent() as never);

      // A new turn has started on the same task before the release fires.
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await vi.advanceTimersByTimeAsync(5_000);

      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      expect(log.mock.calls.join('\n')).toContain('reason=task_active');
      service.dispose();
    } finally {
      log.mockRestore();
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('explicit recovery cancels a waiting backoff release', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const clearTurnFailureReleasePending = vi.fn();
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        releaseTaskAfterTurnFailure,
        clearTurnFailureReleasePending,
        taskInboxState: inbox,
      });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await service.handleAgentTurnEnded(failedTurnEvent() as never);

      await service.prepareRoleRecovery({ chatroomId: 'room-1', role: 'builder' });
      await service.recoverStoppedRole({
        chatroomId: 'room-1',
        role: 'builder',
        mode: 'explicit',
      });
      await vi.advanceTimersByTimeAsync(60_000);

      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      expect(clearTurnFailureReleasePending).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('cancels a waiting release on a user start and on a user restart', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      for (const reason of [AgentStartReasonCode.USER_START, AgentStartReasonCode.USER_RESTART]) {
        let startedHandler: ((event: never) => Promise<void>) | undefined;
        const releaseTaskAfterTurnFailure = vi.fn(async () => ({
          released: true,
          status: 'pending' as const,
          updatedAt: 1700000000000,
        }));
        const inbox = new TaskInboxState();
        inbox.upsert([inProgressTask('task-1')]);
        const service = createService({
          releaseTaskAfterTurnFailure,
          taskInboxState: inbox,
          onAgentStarted: (handler) => {
            startedHandler = handler as never;
          },
        });
        service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
        await service.handleAgentTurnEnded(failedTurnEvent() as never);

        await startedHandler?.({
          chatroomId: 'room-1',
          role: 'builder',
          reason,
        } as never);
        await vi.advanceTimersByTimeAsync(60_000);

        expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
        service.dispose();
      }
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('cancels a waiting release on dispose', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({ releaseTaskAfterTurnFailure, taskInboxState: inbox });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await service.handleAgentTurnEnded(failedTurnEvent() as never);

      service.dispose();
      await vi.advanceTimersByTimeAsync(60_000);

      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('marks the backoff release for auto-recovery and clears the marker when it fires', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const markTurnFailureReleasePending = vi.fn();
      const clearTurnFailureReleasePending = vi.fn();
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        markTurnFailureReleasePending,
        clearTurnFailureReleasePending,
        taskInboxState: inbox,
      });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      await service.handleAgentTurnEnded(failedTurnEvent() as never);

      expect(markTurnFailureReleasePending).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });
      expect(clearTurnFailureReleasePending).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(clearTurnFailureReleasePending).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('a failed deferred release retries with the next backoff delay', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi
        .fn()
        .mockRejectedValueOnce(new Error('backend unavailable'))
        .mockResolvedValue({ released: true, status: 'pending', updatedAt: 1700000000000 });
      const recordTurnFailure = vi
        .fn()
        .mockResolvedValueOnce({ attempts: 1, exceeded: false })
        .mockResolvedValueOnce({ attempts: 2, exceeded: false });
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        releaseTaskAfterTurnFailure,
        recordTurnFailure,
        taskInboxState: inbox,
      });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      await service.handleAgentTurnEnded(failedTurnEvent() as never);
      await vi.advanceTimersByTimeAsync(5_000);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(1);
      expect(recordTurnFailure).toHaveBeenCalledTimes(2);
      expect(recordTurnFailure).toHaveBeenLastCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });

      // The second release waits the second delay, not the first.
      await vi.advanceTimersByTimeAsync(9_999);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(2);
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('a release that keeps failing parks after the cap and leaves no timer', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => {
        throw new Error('backend unavailable');
      });
      let attempts = 0;
      const recordTurnFailure = vi.fn(async () => {
        attempts += 1;
        return { attempts, exceeded: attempts >= 8 };
      });
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        releaseTaskAfterTurnFailure,
        recordTurnFailure,
        taskInboxState: inbox,
      });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      await service.handleAgentTurnEnded(failedTurnEvent() as never);
      // 5 + 10 + 20 + 40 + 80 + 160 + 300 seconds of retries.
      await vi.advanceTimersByTimeAsync(615_000);

      expect(attempts).toBe(8);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(7);
      expect(vi.getTimerCount()).toBe(0);

      await vi.advanceTimersByTimeAsync(10 * 60 * 60_000);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(7);
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('skips the release when the task is no longer current when the timer fires', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({ releaseTaskAfterTurnFailure, taskInboxState: inbox });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
      await service.handleAgentTurnEnded(failedTurnEvent() as never);

      inbox.remove('room-1', 'builder', 'task-1', Date.now());
      await vi.advanceTimersByTimeAsync(60_000);

      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      expect(log.mock.calls.join('\n')).toContain('reason=task_not_current');
      service.dispose();
    } finally {
      log.mockRestore();
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('a user.start agent restart clears redelivery tracking', async () => {
    let startedHandler: ((event: never) => Promise<void>) | undefined;
    const clearRedeliveryTracking = vi.fn();
    const service = createService({
      onAgentStarted: (handler) => {
        startedHandler = handler as never;
      },
      clearRedeliveryTracking,
    });
    await startedHandler?.({
      chatroomId: 'room-1',
      role: 'builder',
      reason: AgentStartReasonCode.USER_START,
    } as never);
    expect(clearRedeliveryTracking).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
    });
    service.dispose();
  });

  test('does not release an active task covered by the latest handoff', async () => {
    const releaseTaskAfterTurnFailure = vi.fn();
    const decideUncoveredTurnEnd = vi.fn();
    const resetTurnTracking = vi.fn();
    const service = createService({
      releaseTaskAfterTurnFailure,
      getLatestHandoff: async () => ({ taskIds: ['task-1'] }),
      decideUncoveredTurnEnd,
      resetTurnTracking,
    });
    service.recordTaskDelivered({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-1',
    });

    await service.handleAgentTurnEnded({
      chatroomId: 'room-1',
      role: 'builder',
      pid: 42,
      harness: 'opencode-sdk',
      slot: { state: 'running', nativeTurnPhase: 'turn_in_flight' },
      eventId: 'turn-with-handoff',
      completion: { turnId: 'turn-with-handoff', status: 'completed', source: 'provider.result' },
    } as never);

    expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
    expect(decideUncoveredTurnEnd).not.toHaveBeenCalled();
    expect(resetTurnTracking).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-1',
    });
    service.dispose();
  });

  test('stops the active agent when its task is cancelled', async () => {
    const stopAgent = vi.fn().mockResolvedValue({ success: true });
    const service = createService({
      getSlot: () => ({ state: 'running', pid: 42 }),
      stopAgent,
    });
    service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

    await service.handleTaskServiceNotification({
      kind: 'inbox-event',
      event: {
        eventType: 'task_deleted',
        eventId: 'event-task-deleted',
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      } as never,
    });

    expect(stopAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        chatroomId: 'room-1',
        role: 'builder',
        pid: 42,
        reason: 'platform.task_cancelled',
      }),
      expect.any(AbortSignal)
    );
    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    service.dispose();
  });

  test('acknowledges an inbox event when the authoritative task was removed', async () => {
    const forgetStaleTask = vi.fn();
    const task = {
      taskId: 'task-stale-event',
      chatroomId: 'room-1',
      status: 'pending',
      assignedTo: 'builder',
      updatedAt: 1,
      createdAt: 1,
      agentConfig: { role: 'builder', machineId: 'machine-1' },
    } as AssignedTask;
    const service = createService({
      initialTasks: [task],
      getSlot: () => ({ state: 'running', pid: 42 }),
      loadAssignedTaskForAction: async () => null,
      forgetStaleTask,
    });
    const requestReconcile = vi.spyOn(service, 'requestReconcile');

    const confirmation = await service.handleTaskServiceNotification({
      kind: 'inbox-event',
      event: {
        eventId: 'event-stale',
        eventType: 'task_updated',
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-stale-event',
      } as never,
    });

    expect(confirmation).toEqual({ handledEventIds: ['event-stale'] });
    expect(forgetStaleTask).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-stale-event',
    });
    expect(requestReconcile).not.toHaveBeenCalled();
    service.dispose();
  });

  test('evicts a removed task during periodic reconciliation without waking an agent', async () => {
    const forgetStaleTask = vi.fn();
    const service = createService({
      getSlot: () => ({ state: 'running', pid: 42 }),
      loadAssignedTaskForAction: async () => null,
      forgetStaleTask,
    });
    const requestReconcile = vi.spyOn(service, 'requestReconcile');

    await service.handleTaskServiceNotification({
      kind: 'periodic-reconcile',
      task: {
        taskId: 'task-stale-periodic',
        chatroomId: 'room-1',
        agentConfig: { role: 'builder' },
      } as never,
    });

    expect(forgetStaleTask).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-stale-periodic',
    });
    expect(requestReconcile).not.toHaveBeenCalled();
    service.dispose();
  });

  test.each([
    ['absent', undefined, false],
    ['idle', { state: 'idle' }, false],
    ['stopping', { state: 'stopping', pid: 42 }, false],
    ['running without a PID', { state: 'running' }, false],
    ['stopped by intent', { state: 'running', pid: 42 }, true],
  ])(
    'acknowledges a pending inbox event for a %s role without evicting its snapshot',
    async (_label, slot, stopRequested) => {
      const task = pendingTask('task-stopped-event');
      const inbox = new TaskInboxState();
      inbox.upsert([task]);
      const loadAssignedTaskForAction = vi.fn(async () => task);
      const acquireNativeDeliverySlot = vi.fn();
      const recordDeliveryFailure = vi.fn();
      const service = createService({
        taskInboxState: inbox,
        initialTasks: [task],
        getSlot: () => slot as never,
        isStopRequested: () => stopRequested,
        loadAssignedTaskForAction,
        acquireNativeDeliverySlot,
        recordDeliveryFailure,
      });

      const confirmation = await service.handleTaskServiceNotification({
        kind: 'inbox-event',
        event: {
          eventId: 'event-stopped-role',
          eventType: 'task_updated',
          chatroomId: 'room-1',
          role: 'builder',
          taskId: task.taskId,
        } as never,
      });

      expect(confirmation).toEqual({ handledEventIds: ['event-stopped-role'] });
      expect(loadAssignedTaskForAction).not.toHaveBeenCalled();
      expect(acquireNativeDeliverySlot).not.toHaveBeenCalled();
      expect(recordDeliveryFailure).not.toHaveBeenCalled();
      expect(inbox.getForRole('room-1', 'builder', task.taskId)?.status).toBe('pending');
      service.dispose();
    }
  );

  test('periodic reconcile skips authoritative hydration for a stopped role', async () => {
    const task = pendingTask('task-stopped-periodic');
    const inbox = new TaskInboxState();
    inbox.upsert([task]);
    const loadAssignedTaskForAction = vi.fn(async () => task);
    const acquireNativeDeliverySlot = vi.fn();
    const service = createService({
      taskInboxState: inbox,
      initialTasks: [task],
      getSlot: () => ({ state: 'idle' }),
      loadAssignedTaskForAction,
      acquireNativeDeliverySlot,
    });
    const requestReconcile = vi.spyOn(service, 'requestReconcile');

    await service.handleTaskServiceNotification({
      kind: 'periodic-reconcile',
      task,
    });

    expect(loadAssignedTaskForAction).not.toHaveBeenCalled();
    expect(requestReconcile).not.toHaveBeenCalled();
    expect(acquireNativeDeliverySlot).not.toHaveBeenCalled();
    expect(inbox.getForRole('room-1', 'builder', task.taskId)?.status).toBe('pending');
    service.dispose();
  });

  test('reconcile after recovery leaves a stopped role pending', async () => {
    const task = pendingTask('task-recovered-pending');
    const inbox = new TaskInboxState();
    inbox.upsert([task]);
    const acquireNativeDeliverySlot = vi.fn();
    const service = createService({
      taskInboxState: inbox,
      initialTasks: [task],
      getSlot: () => ({ state: 'idle' }),
      acquireNativeDeliverySlot,
    });

    await expect(
      service.requestReconcile({
        chatroomId: 'room-1',
        role: 'builder',
        source: 'periodic-reconcile',
      })
    ).resolves.toEqual([]);
    expect(acquireNativeDeliverySlot).not.toHaveBeenCalled();
    expect(inbox.getForRole('room-1', 'builder', task.taskId)?.status).toBe('pending');
    service.dispose();
  });

  test('reconcileAfterAgentRestart returns delivered task ids', async () => {
    const service = createService();
    const order: string[] = [];
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
        return ['task-1', 'task-2'];
      });

    const delivered = await service.reconcileAfterAgentRestart({
      chatroomId: 'room-1',
      role: 'builder',
    });

    expect(requestReconcile).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['reconcile']);
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

  test('records task state before native delivery starts', () => {
    const service = createService();

    service.recordTaskDeliveryStarted({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-started',
      harnessSessionId: 'session-1',
    });

    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toMatchObject({
      taskId: 'task-started',
    });
    service.dispose();
  });

  test('clears the matching task after native delivery fails', () => {
    const service = createService();
    service.recordTaskDeliveryStarted({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-failed',
      harnessSessionId: 'session-1',
    });

    service.recordTaskDeliveryFailed({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-failed',
    });

    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
    service.dispose();
  });

  test('does not clear a newer task after an older delivery fails', () => {
    const service = createService();
    service.recordTaskDeliveryStarted({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-newer',
      harnessSessionId: 'session-1',
    });

    service.recordTaskDeliveryFailed({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-older',
    });

    expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toMatchObject({
      taskId: 'task-newer',
    });
    service.dispose();
  });

  test('schedules delivery after an agent-end event', async () => {
    let onTurnEnded: ((event: never) => Promise<unknown>) | undefined;
    const service = createService({
      onTurnEnded: (handler) => {
        onTurnEnded = handler;
      },
    });
    const requestReconcile = vi.spyOn(service, 'requestReconcile').mockResolvedValue([]);

    await onTurnEnded?.({
      chatroomId: 'room-1',
      role: 'builder',
      pid: 42,
      harness: 'cursor-sdk',
      slot: { state: 'running' },
      eventId: 'turn-1',
      completion: {
        turnId: 'turn-1',
        status: 'completed',
        source: 'provider.result',
      },
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
    const facts: Record<string, unknown>[] = [];
    const service = createService({
      enqueueFact: async (fact) => {
        facts.push(fact);
      },
      getLatestHandoff: async () => ({ taskIds: ['task-1'] }),
    });
    service.recordTaskDelivered({
      chatroomId: 'room-1',
      role: 'builder',
      taskId: 'task-1',
    });

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
    expect(facts).toEqual([
      expect.objectContaining({
        kind: 'status',
        chatroomId: 'room-1',
        role: 'builder',
        status: 'waiting',
      }),
    ]);
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
    const requestReconcile = vi.spyOn(service, 'requestReconcile').mockResolvedValue([]);
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
    const requestReconcile = vi.spyOn(service, 'requestReconcile').mockResolvedValue([]);

    await onAgentStarted?.({ chatroomId: 'room-1', role: 'builder' } as never);

    expect(requestReconcile).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'builder',
      source: 'agent-started',
    });
    service.dispose();
  });

  test('unexpected exit installs a gate synchronously and recovers once', async () => {
    let onSessionLost: ((event: never) => void) | undefined;
    const recoverInFlightTasks = vi.fn(async () => ({ released: 1, skipped: 0 }));
    const service = createService({
      onSessionLost: (handler) => {
        onSessionLost = handler;
      },
      getSlot: () => ({ state: 'running', pid: 41 }),
      recoverInFlightTasks,
    });
    onSessionLost?.({ chatroomId: 'room-1', role: 'Builder', pid: 41 } as never);
    onSessionLost?.({ chatroomId: 'room-1', role: 'builder', pid: 41 } as never);
    expect((service as any).recoveryGates.has('room-1:builder')).toBe(true);
    await vi.waitFor(() => expect(recoverInFlightTasks).toHaveBeenCalledOnce());
    expect(recoverInFlightTasks).toHaveBeenCalledWith({
      chatroomId: 'room-1',
      role: 'Builder',
      mode: 'automatic',
    });
    expect((service as any).recoveryGates.has('room-1:builder')).toBe(false);
    service.dispose();
  });

  test('ignores an exit callback whose PID belongs to a replaced slot', () => {
    let onSessionLost: ((event: never) => void) | undefined;
    const recoverInFlightTasks = vi.fn();
    const service = createService({
      onSessionLost: (handler) => {
        onSessionLost = handler;
      },
      getSlot: () => ({ state: 'running', pid: 99 }),
      recoverInFlightTasks,
    });
    onSessionLost?.({
      chatroomId: 'room-1',
      role: 'builder',
      pid: 41,
    } as never);
    expect((service as any).recoveryGates.size).toBe(0);
    expect(recoverInFlightTasks).not.toHaveBeenCalled();
    service.dispose();
  });

  test('ignores an exit callback with a matching PID but stale harness session', () => {
    let onSessionLost: ((event: never) => void) | undefined;
    const recoverInFlightTasks = vi.fn();
    const service = createService({
      onSessionLost: (handler) => {
        onSessionLost = handler;
      },
      getSlot: () => ({ state: 'running', pid: 41, harnessSessionId: 'replacement-session' }),
      recoverInFlightTasks,
    });
    onSessionLost?.({
      chatroomId: 'room-1',
      role: 'builder',
      pid: 41,
      harnessSessionId: 'old-session',
    } as never);
    expect((service as any).recoveryGates.size).toBe(0);
    expect(recoverInFlightTasks).not.toHaveBeenCalled();
    service.dispose();
  });

  test('role recovery waits for an already running native sender to drain', async () => {
    let finishSender!: () => void;
    let senderStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      senderStarted = resolve;
    });
    const senderTail = new Promise<void>((resolve) => {
      finishSender = resolve;
    });
    const recoverInFlightTasks = vi.fn(async () => ({ released: 1, skipped: 0 }));
    const service = createService({ recoverInFlightTasks });
    const queue = new NativeTaskDeliveryQueue(async () => {
      senderStarted();
      await senderTail;
    });
    (service as any).nativeTaskDeliveryQueue = queue;
    const sending = queue.enqueue({
      task: { chatroomId: 'room-1', agentConfig: { role: 'builder' } } as never,
      harnessSessionId: 'old-session',
      onTaskDelivered: undefined,
    });
    await started;
    const prepare = service.prepareRoleRecovery({ chatroomId: 'room-1', role: 'builder' });
    const recovery = service.recoverStoppedRole({
      chatroomId: 'room-1',
      role: 'builder',
      mode: 'automatic',
    });
    await Promise.resolve();
    expect(recoverInFlightTasks).not.toHaveBeenCalled();
    finishSender();
    await Promise.all([sending, prepare]);
    await expect(recovery).resolves.toEqual({ released: 1 });
    expect(recoverInFlightTasks).toHaveBeenCalledOnce();
    service.dispose();
  });

  test('failed automatic recovery retains the gate, retries, then reopens it', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let onSessionLost: ((event: never) => void) | undefined;
    const recoverInFlightTasks = vi
      .fn()
      .mockRejectedValueOnce(new Error('backend unavailable'))
      .mockResolvedValue({ released: 0, skipped: 0 });
    const service = createService({
      onSessionLost: (handler) => {
        onSessionLost = handler;
      },
      getSlot: () => ({ state: 'running', pid: 41 }),
      recoverInFlightTasks,
    });
    try {
      onSessionLost?.({ chatroomId: 'room-1', role: 'builder', pid: 41 } as never);
      await vi.waitFor(() => expect(recoverInFlightTasks).toHaveBeenCalledTimes(1));
      expect((service as any).recoveryGates.has('room-1:builder')).toBe(true);
      await vi.advanceTimersByTimeAsync(1_000);
      await vi.waitFor(() => expect(recoverInFlightTasks).toHaveBeenCalledTimes(2));
      expect((service as any).recoveryGates.has('room-1:builder')).toBe(false);
    } finally {
      service.dispose();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  test('dispose cancels scheduled automatic recovery retries', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    let onSessionLost: ((event: never) => void) | undefined;
    const recoverInFlightTasks = vi.fn().mockRejectedValue(new Error('backend unavailable'));
    const service = createService({
      onSessionLost: (handler) => {
        onSessionLost = handler;
      },
      getSlot: () => ({ state: 'running', pid: 41 }),
      recoverInFlightTasks,
    });
    try {
      onSessionLost?.({ chatroomId: 'room-1', role: 'builder', pid: 41 } as never);
      await vi.waitFor(() => expect(recoverInFlightTasks).toHaveBeenCalledTimes(1));
      expect((service as any).recoveryGates.get('room-1:builder')?.retryTimer).toBeDefined();
      service.dispose();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(recoverInFlightTasks).toHaveBeenCalledTimes(1);
    } finally {
      service.dispose();
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  test('routes bootstrap notifications by affected role', async () => {
    const service = createService();
    const requestReconcile = vi.spyOn(service, 'requestReconcile').mockResolvedValue([]);
    const snapshot = {
      chatroomId: 'room-1',
      agentConfig: { role: 'builder' },
    } as never;

    await service.handleTaskServiceNotification({ kind: 'bootstrap', tasks: [snapshot] });

    expect(requestReconcile).toHaveBeenNthCalledWith(1, {
      chatroomId: 'room-1',
      role: 'builder',
      source: 'bootstrap',
    });
    service.dispose();
  });

  test('coalesces duplicate role reconciliations and runs a fresh pass afterward', async () => {
    const service = createService({ getSlot: () => ({ state: 'running', pid: 42 }) });
    let release!: () => void;
    const gate = new Promise<readonly string[]>((resolve) => {
      release = () => resolve([]);
    });
    const reconcileRole = vi
      .spyOn(service as any, 'reconcileRole')
      .mockImplementationOnce(async () => gate)
      .mockResolvedValue([]);

    const first = service.requestReconcile({
      chatroomId: 'room-1',
      role: 'Builder',
      source: 'periodic-reconcile',
    });
    const second = service.requestReconcile({
      chatroomId: 'room-1',
      role: 'builder',
      source: 'agent-session-lost',
    });

    release();
    await Promise.all([first, second]);

    expect(reconcileRole).toHaveBeenCalledTimes(2);
    expect(reconcileRole).toHaveBeenNthCalledWith(
      2,
      'agent-session-lost',
      expect.any(Array),
      undefined,
      expect.any(Function)
    );
  });

  test('failed turn with an active task schedules the exact task release after backoff', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => ({
        released: true,
        status: 'pending' as const,
        updatedAt: 1700000000000,
      }));
      const enqueueFact = vi.fn(async () => undefined);
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        releaseTaskAfterTurnFailure,
        enqueueFact,
        taskInboxState: inbox,
      });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      const disposition = await service.handleAgentTurnEnded(failedTurnEvent() as never);

      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();
      expect(disposition).toEqual({ kind: 'release-slot' });
      expect(enqueueFact).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'turn_failed', taskId: 'task-1', turnId: 'turn-1' })
      );

      await vi.advanceTimersByTimeAsync(5_000);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledWith({
        chatroomId: 'room-1',
        role: 'builder',
        taskId: 'task-1',
      });
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('failed-turn disposition resolves before the deferred backend release', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    try {
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
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({ releaseTaskAfterTurnFailure, taskInboxState: inbox });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      const disposition = await service.handleAgentTurnEnded(failedTurnEvent() as never);

      expect(disposition).toEqual({ kind: 'release-slot' });
      expect(releaseTaskAfterTurnFailure).not.toHaveBeenCalled();
      expect(service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })).toBeUndefined();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(1);
      resolveRecovery({ released: true, status: 'pending', updatedAt: 1700000000000 });
      service.dispose();
    } finally {
      random.mockRestore();
      vi.useRealTimers();
    }
  });

  test('a deferred release rejection is logged after the slot was already released', async () => {
    vi.useFakeTimers();
    const random = vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const releaseTaskAfterTurnFailure = vi.fn(async () => {
        throw new Error('backend unavailable');
      });
      const enqueueFact = vi.fn(async () => undefined);
      const inbox = new TaskInboxState();
      inbox.upsert([inProgressTask('task-1')]);
      const service = createService({
        releaseTaskAfterTurnFailure,
        enqueueFact,
        taskInboxState: inbox,
      });
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      const disposition = await service.handleAgentTurnEnded(failedTurnEvent() as never);

      expect(disposition).toEqual({ kind: 'release-slot' });
      expect(enqueueFact).toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(5_000);
      expect(releaseTaskAfterTurnFailure).toHaveBeenCalledTimes(1);
      expect(errorLog.mock.calls.join('\n')).toContain('turn-failed-release-error');
      service.dispose();
    } finally {
      errorLog.mockRestore();
      random.mockRestore();
      vi.useRealTimers();
    }
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

  test('failed turn with no active task releases the slot when projection persistence fails', async () => {
    const enqueueFact = vi.fn(async () => {
      throw new Error('outbox down');
    });
    const service = createService({ enqueueFact });

    const disposition = await service.handleAgentTurnEnded(failedTurnEvent() as never);

    expect(disposition).toEqual({ kind: 'release-slot' });
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

  describe('an undeliverable nudge never leaves the task stuck', () => {
    test('a throwing nudge with restart budget left schedules a restart, not a park', async () => {
      const calls: string[] = [];
      const runSerializedForAgent = vi.fn(async (_key: unknown, _opts: unknown, operation: any) =>
        operation(
          {
            stopAgent: async (input: { reason: string; pid: number }) => {
              calls.push(`stop:${input.reason}:${input.pid}`);
              return { success: true };
            },
            startAgent: async (input: { reason: string; wantResume: boolean }) => {
              calls.push(`start:${input.reason}:${input.wantResume}`);
              return { success: true };
            },
          },
          { signal: new AbortController().signal }
        )
      );
      const decideUncoveredTurnEnd = vi.fn(async (args: { nudgeUnavailable?: boolean }) =>
        args.nudgeUnavailable
          ? { action: 'restart-session' as const }
          : { action: 'nudge' as const }
      );
      const service = createService({
        runSerializedForAgent,
        agentConfig: restartConfig,
        getSlot: runningSlot,
        decideUncoveredTurnEnd,
        resumeTurnForSlot: vi.fn(async () => {
          throw new Error('send failed');
        }),
        initialTasks: [pendingTask('task-1')],
      });
      const internals = service as unknown as {
        prepareRoleRecovery(args: unknown): Promise<void>;
        recoverStoppedRole(args: unknown): Promise<{ released: number }>;
      };
      vi.spyOn(internals, 'prepareRoleRecovery').mockImplementation(async () => {
        calls.push('prepare');
      });
      vi.spyOn(internals, 'recoverStoppedRole').mockImplementation(async () => {
        calls.push('recover');
        return { released: 1 };
      });
      const scheduleRoleDelivery = vi.spyOn(service as never, 'scheduleRoleDelivery');
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      await service.handleAgentTurnEnded(completedTurnEvent() as never);
      await vi.waitFor(() =>
        expect(calls).toEqual([
          'prepare',
          'stop:daemon.respawn:42',
          'recover',
          'start:daemon.respawn:false',
        ])
      );
      await flushTimers();

      expect(decideUncoveredTurnEnd).toHaveBeenLastCalledWith(
        expect.objectContaining({ nudgeUnavailable: true, sessionKey: '42:sess-1' })
      );
      // The restart path replaces the session instead of re-delivering into it.
      expect(scheduleRoleDelivery).not.toHaveBeenCalled();
      service.dispose();
    });

    test('a throwing nudge with the restart budget spent parks: no restart, active state cleared', async () => {
      const runSerializedForAgent = vi.fn();
      const decideUncoveredTurnEnd = vi.fn(async (args: { nudgeUnavailable?: boolean }) =>
        args.nudgeUnavailable ? { action: 'park' as const } : { action: 'nudge' as const }
      );
      const service = createService({
        runSerializedForAgent,
        agentConfig: restartConfig,
        getSlot: runningSlot,
        decideUncoveredTurnEnd,
        resumeTurnForSlot: vi.fn(async () => {
          throw new Error('send failed');
        }),
        initialTasks: [pendingTask('task-1')],
      });
      const scheduleRoleDelivery = vi.spyOn(service as never, 'scheduleRoleDelivery');
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      await service.handleAgentTurnEnded(completedTurnEvent() as never);
      await vi.waitFor(() =>
        expect(
          service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })
        ).toBeUndefined()
      );

      expect(decideUncoveredTurnEnd).toHaveBeenLastCalledWith(
        expect.objectContaining({ nudgeUnavailable: true, sessionKey: '42:sess-1' })
      );
      expect(runSerializedForAgent).not.toHaveBeenCalled();
      // Park action: the task service recorded redelivery_exhausted, then delivery is scheduled.
      expect(scheduleRoleDelivery).toHaveBeenCalledWith('room-1', 'builder');
      service.dispose();
    });

    test('a restart without agent config parks instead of leaving the task active', async () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const runSerializedForAgent = vi.fn();
      const decideUncoveredTurnEnd = vi.fn(async (args: { nudgeUnavailable?: boolean }) =>
        args.nudgeUnavailable ? { action: 'park' as const } : { action: 'restart-session' as const }
      );
      const service = createService({
        runSerializedForAgent,
        getSlot: () => ({ state: 'running', pid: 42, harnessSessionId: 'sess-1' }),
        decideUncoveredTurnEnd,
        initialTasks: [pendingTask('task-1')],
      });
      const scheduleRoleDelivery = vi.spyOn(service as never, 'scheduleRoleDelivery');
      service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });

      await service.handleAgentTurnEnded(completedTurnEvent() as never);
      await vi.waitFor(() =>
        expect(
          service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })
        ).toBeUndefined()
      );

      expect(errors).toHaveBeenCalledWith(expect.stringContaining('error=missing_agent_config'));
      expect(decideUncoveredTurnEnd).toHaveBeenLastCalledWith(
        expect.objectContaining({ nudgeUnavailable: true, sessionKey: '42:sess-1' })
      );
      expect(runSerializedForAgent).not.toHaveBeenCalled();
      expect(scheduleRoleDelivery).toHaveBeenCalledWith('room-1', 'builder');
      errors.mockRestore();
      service.dispose();
    });

    test('a busy delivery mutex retries the nudge a bounded number of times, then escalates', async () => {
      vi.useFakeTimers();
      try {
        const decideUncoveredTurnEnd = vi.fn(async (args: { nudgeUnavailable?: boolean }) =>
          args.nudgeUnavailable ? { action: 'park' as const } : { action: 'nudge' as const }
        );
        const resumeTurnForSlot = vi.fn(async () => undefined);
        const confirmNudgeSent = vi.fn();
        const service = createService({
          initialTasks: [pendingTask('task-1')],
          resumeTurnForSlot,
          confirmNudgeSent,
          decideUncoveredTurnEnd,
          getSlot: runningSlot,
        });
        service.recordTaskDelivered({ chatroomId: 'room-1', role: 'builder', taskId: 'task-1' });
        const deliveryState = getRoleDeliveryState();
        expect(deliveryState.tryAcquireDelivery('room-1', 'builder')).toBe(true);
        try {
          await service.handleAgentTurnEnded(completedTurnEvent() as never);
          await vi.advanceTimersByTimeAsync(1_000);
        } finally {
          deliveryState.releaseDelivery('room-1', 'builder');
        }

        expect(resumeTurnForSlot).not.toHaveBeenCalled();
        expect(confirmNudgeSent).not.toHaveBeenCalled();
        // After the bounded retries the ladder escalates rather than dropping silently.
        expect(decideUncoveredTurnEnd).toHaveBeenLastCalledWith(
          expect.objectContaining({ nudgeUnavailable: true, sessionKey: '42:sess-1' })
        );
        expect(
          service.agentTaskState.get({ chatroomId: 'room-1', role: 'builder' })
        ).toBeUndefined();
        service.dispose();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
