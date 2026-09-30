/**
 * Daemon native delivery after agent_end + queue promotion — integration test
 *
 * Uses mocked harness (no real LLM calls). Included in default `pnpm test` suite.
 * Uses snapshot/participant shape produced by backend integration test.
 * Wires NativeTaskDeliveryCoordinator → runNativeInjectionEffect → resumeTurn.
 */

import type { Id } from '@workspace/backend/convex/_generated/dataModel.js';
import { AgentStartReasonCode } from '@workspace/backend/src/domain/entities/agent.js';
import { WorkspaceTaskInboxEventType } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { NATIVE_TASK_INJECTED_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { resolveSessionAugmentationForTask } from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import { Effect } from 'effect';
import { describe, expect, test, vi } from 'vitest';

import { NativeTaskDeliveryCoordinator } from './native-task-delivery-coordinator.js';
import {
  createTaskState,
  taskDocToSignal,
  type TaskFixtureDoc,
} from './test-fixtures/task-fixture.js';
import { withTestTaskService } from './test-task-service.js';
import type { AssignedTaskWithContent } from '../../../../domain/entities/assigned-task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../../../entry/daemon-services.js';
import { runRestartOrchestrator } from '../../../../entry/restart-orchestrator.js';
import { TaskInboxState } from '../../../../infrastructure/inbox/task-inbox-state.js';
import {
  AgentWorkManager,
  createAgentProcessManagerService,
  createAgentTaskStateService,
  type AgentKey,
  type SerializedAgentOperationContext,
  type SerializedAgentOperationOptions,
  type SerializedAgentOperations,
} from '../../../agent-process-service/index.js';
import type { NativeDeliverySessionHandles } from '../../../service-interfaces.js';
import { buildNativeInjectionPrompt, shouldDeliverNativeTask } from '../../index.js';

type NativeTaskDeliverySessionDeps = NativeDeliverySessionHandles & { convexUrl: string };

const HARNESS_SESSION_ID = 'harness-session-post-agent-end';
const MACHINE_ID = 'machine-native-queued-delivery';
const SESSION_ID = 'session-native-queued-delivery';

function makePostAgentEndSnapshotDoc(overrides: Partial<TaskFixtureDoc> = {}): TaskFixtureDoc {
  const now = 1_700_000_000_000;
  return {
    machineId: MACHINE_ID,
    taskId: 'task_promoted' as Id<'chatroom_tasks'>,
    chatroomId: 'room_1' as Id<'chatroom_rooms'>,
    role: 'builder',
    taskStatus: 'pending',
    taskAssignedTo: 'builder',
    taskCreatedAt: now,
    taskUpdatedAt: now,
    agentHarness: 'cursor-sdk',
    workingDir: '/test/workspace',
    configUpdatedAt: now,
    revisionKey: 'revision-key',
    ...overrides,
  };
}

function makeFullTaskFromSnapshot(
  row: NonNullable<ReturnType<ReturnType<typeof createTaskState>['mergeSignal']>>
): AssignedTaskWithContent {
  return {
    ...row,
    taskContent: '## Goal\nQueued follow-up after agent_end',
  };
}

function makeNativeSlot(state: 'idle' | 'running', pid?: number) {
  return {
    state,
    ...(pid === undefined ? {} : { pid }),
    harness: 'cursor-sdk',
    model: 'test-model',
    workingDir: '/test/workspace',
    ...(state === 'running'
      ? { harnessSessionId: `${HARNESS_SESSION_ID}-${pid}`, nativeTurnPhase: 'idle' as const }
      : {}),
  };
}

describe('native queued delivery after agent_end', () => {
  test('recovered pending tasks wait through stop and boot until explicit start', async () => {
    const chatroomId = 'room_1';
    const builderSnapshot = createTaskState();
    builderSnapshot.replaceAll([]);
    const builderTask = builderSnapshot.mergeSignal(
      taskDocToSignal(
        makePostAgentEndSnapshotDoc({
          taskId: 'task_builder_recovered' as Id<'chatroom_tasks'>,
          taskStatus: 'in_progress',
          role: 'builder',
          taskAssignedTo: 'builder',
        })
      )
    )!;
    const reviewerSnapshot = createTaskState();
    reviewerSnapshot.replaceAll([]);
    const reviewerTask = reviewerSnapshot.mergeSignal(
      taskDocToSignal(
        makePostAgentEndSnapshotDoc({
          taskId: 'task_reviewer_running' as Id<'chatroom_tasks'>,
          role: 'reviewer',
          taskAssignedTo: 'reviewer',
        })
      )
    )!;
    const inbox = new TaskInboxState();
    inbox.replace([builderTask, reviewerTask]);
    const backendStatuses = new Map<string, string>([
      [builderTask.taskId, 'in_progress'],
      [reviewerTask.taskId, 'pending'],
    ]);
    const claims = vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
      const taskId = String(args.taskId);
      expect(backendStatuses.get(taskId)).toBe('pending');
      backendStatuses.set(taskId, 'in_progress');
    });
    const resumeTurnForSlot = vi.fn(async (_args: Record<string, unknown>) => undefined);
    const slotByRole = new Map<string, ReturnType<typeof makeNativeSlot>>([
      ['builder', makeNativeSlot('running', 201)],
      ['reviewer', makeNativeSlot('running', 202)],
    ]);
    const stopIntent = new Set<string>(['builder']);
    let acquireCalls = 0;
    let startCalls = 0;
    let startedListener: ((event: never) => Promise<unknown>) | undefined;
    let taskListener:
      | ((notification: {
          kind: 'inbox-event' | 'periodic-reconcile';
          event?: never;
          task?: never;
        }) => Promise<unknown>)
      | undefined;
    const serviceExecution = {
      runSerializedForAgent: async (_key: unknown, op: () => Promise<unknown>) => op(),
      ensureRunning: async () => {
        startCalls += 1;
        throw new Error('autonomous start must not run');
      },
      stop: async () => ({ success: true }),
      handleExit: async () => undefined,
      reset: async () => undefined,
      getSlot: (_room: string, role: string) => slotByRole.get(role),
      isStopRequested: (_room: string, role: string) => stopIntent.has(role),
      listActive: () => [],
      clearStuckStoppingSlot: async () => false,
      whenTurnEndsIdle: async () => undefined,
      resumeTurnForSlot,
      subscribeAgentTurnEnded: () => () => undefined,
      subscribeAgentStarted: () => () => undefined,
      subscribeAgentSessionLost: () => () => undefined,
      subscribeAgentTurnProgress: () => () => undefined,
    };
    const commandBus = { send: vi.fn(async () => undefined) };
    const notifier = { subscribe: () => () => undefined };
    const createProcessManager = () =>
      createAgentProcessManagerService({
        execution: serviceExecution as never,
        commandBus: commandBus as never,
        notifier: notifier as never,
      });
    const processManager = createProcessManager();
    const assignedById = new Map([
      [builderTask.taskId, makeFullTaskFromSnapshot(builderTask)],
      [reviewerTask.taskId, makeFullTaskFromSnapshot(reviewerTask)],
    ]);
    const backend = {
      mutation: vi.fn(async (fn: unknown, args: Record<string, unknown>) => {
        const taskId = typeof args.taskId === 'string' ? args.taskId : undefined;
        if (taskId && backendStatuses.get(taskId) === 'pending') {
          await claims(fn, args);
        }
        return { cleared: true, recorded: true, processed: true, marked: true };
      }),
      query: vi.fn(async (fn: unknown, args: Record<string, unknown>) => {
        if ('machineId' in args && 'taskId' in args && !('chatroomId' in args)) {
          return assignedById.get(String(args.taskId)) ?? null;
        }
        if ('chatroomId' in args && 'taskId' in args) return { fullCliOutput: 'DELIVERY OUTPUT' };
        throw new Error(`Unexpected query with keys: ${Object.keys(args).join(',')}`);
      }),
    };
    const taskService = {
      subscribe: (listener: (notification: never) => Promise<unknown>) => {
        taskListener = listener as typeof taskListener;
        return () => {
          taskListener = undefined;
        };
      },
      startTaskInbox: async () => undefined,
      stopTaskInbox: () => undefined,
      listTasksForRole: (room: string, role: string) => inbox.listForRole(room, role as never),
      listAllTasks: () => inbox.listAll(),
      taskInboxState: inbox,
      recoverInFlightTasks: vi.fn(async (args: { role: string }) => {
        expect(slotByRole.get(args.role)?.state).toBe('running');
        backendStatuses.set(builderTask.taskId, 'pending');
        inbox.markStatus(chatroomId, 'builder', builderTask.taskId, 'pending', 1_700_000_000_001);
        slotByRole.set('builder', makeNativeSlot('idle'));
        return { released: 1, skipped: 0 };
      }),
      loadAssignedTaskForAction: vi.fn(async ({ taskId }: { taskId: string }) =>
        assignedById.get(taskId)
      ),
      recordDeliveryFailure: vi.fn(),
      clearDeliveryFailure: vi.fn(),
      recordUncoveredTurnEnd: vi.fn(async () => ({ exceeded: false })),
      releaseTaskAfterTurnFailure: vi.fn(),
      getLatestHandoff: vi.fn(async () => null),
      isRedeliveryExhausted: vi.fn(() => false),
      clearRedeliveryTracking: vi.fn(),
      forgetStaleTask: vi.fn(),
      handleAgentTurnProgress: vi.fn(),
      explainNativeDeliveryBlock: () => null,
    } as never;
    const configurationService = {
      get: (_room: string, _role: string) => ({
        agentHarness: 'cursor-sdk',
        model: 'test-model',
        workingDir: '/test/workspace',
      }),
    };
    const createWorkManager = (
      state: TaskInboxState,
      managerService: ReturnType<typeof createProcessManager>
    ) =>
      new AgentWorkManager({
        configurationService: configurationService as never,
        agentMgr: {
          getSlot: (_room: string, role: string) => slotByRole.get(role),
          isStopRequested: (_room: string, role: string) => stopIntent.has(role),
          resumeTurnForSlot: (args: never) => Effect.promise(() => resumeTurnForSlot(args)),
          subscribeAgentStarted: (listener: (event: never) => Promise<unknown>) => {
            startedListener = listener;
            return () => {
              startedListener = undefined;
            };
          },
          subscribeAgentTurnEnded: () => () => undefined,
          subscribeAgentSessionLost: () => () => undefined,
          subscribeAgentTurnProgress: () => () => undefined,
        } as never,
        runSerializedForAgent: managerService.runSerializedForAgent.bind(managerService),
        acquireNativeDeliverySlot: async (input) => {
          acquireCalls += 1;
          return managerService.acquireNativeDeliverySlot(input);
        },
        sessionDeps: {
          sessionId: SESSION_ID,
          convexUrl: 'http://test:3210',
          machineId: MACHINE_ID,
          backend,
        } as never,
        machineId: MACHINE_ID,
        taskInboxState: state,
        agentTaskState: createAgentTaskStateService(),
        lifecycleOutbox: { enqueue: async () => undefined },
        taskService,
      });
    const inboxEvent = (taskId: string, role: string, eventId: string) => ({
      kind: 'inbox-event' as const,
      event: {
        eventId,
        machineId: MACHINE_ID,
        chatroomId,
        taskId,
        role,
        eventType: WorkspaceTaskInboxEventType.TaskUpdated,
        status: 'pending',
        createdAt: Date.now(),
        task: {},
      },
    });
    const periodic = (task: typeof builderTask) => ({ kind: 'periodic-reconcile' as const, task });
    const builderPending = () => inbox.getForRole(chatroomId, 'builder', builderTask.taskId);

    const manager = createWorkManager(inbox, processManager);
    await manager.prepareRoleRecovery({ chatroomId, role: 'builder', pid: 201 });
    await manager.recoverStoppedRole({ chatroomId, role: 'builder', mode: 'explicit' });
    expect(backendStatuses.get(builderTask.taskId)).toBe('pending');
    expect(builderPending()?.status).toBe('pending');

    const firstAck = await taskListener!(
      inboxEvent(builderTask.taskId, 'builder', 'stop-event-1') as never
    );
    await taskListener!(inboxEvent(builderTask.taskId, 'builder', 'stop-event-2') as never);
    await taskListener!(periodic(builderPending()!) as never);
    expect(firstAck).toEqual({ handledEventIds: ['stop-event-1'] });
    expect(acquireCalls).toBe(0);
    expect(startCalls).toBe(0);
    expect(claims).not.toHaveBeenCalled();
    expect(resumeTurnForSlot).not.toHaveBeenCalled();
    expect(builderPending()?.status).toBe('pending');

    await manager.disposeAndDrain();
    const bootInbox = new TaskInboxState();
    bootInbox.replace(inbox.listAll());
    const bootProcessManager = createProcessManager();
    const bootManager = createWorkManager(bootInbox, bootProcessManager);
    await taskListener!(inboxEvent(builderTask.taskId, 'builder', 'boot-event') as never);
    await taskListener!(
      periodic(bootInbox.getForRole(chatroomId, 'builder', builderTask.taskId)!) as never
    );
    expect(bootInbox.getForRole(chatroomId, 'builder', builderTask.taskId)?.status).toBe('pending');
    expect(acquireCalls).toBe(0);
    expect(startCalls).toBe(0);

    const reviewerAck = await taskListener!(
      inboxEvent(reviewerTask.taskId, 'reviewer', 'reviewer-event') as never
    );
    await vi.waitFor(() => expect(resumeTurnForSlot).toHaveBeenCalledTimes(1));
    expect(reviewerAck).toEqual({ deliveredTaskIds: [reviewerTask.taskId] });
    expect(resumeTurnForSlot.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ role: 'reviewer' })
    );
    expect(backendStatuses.get(builderTask.taskId)).toBe('pending');
    expect(claims).toHaveBeenCalledTimes(1);

    slotByRole.set('builder', makeNativeSlot('running', 203));
    stopIntent.delete('builder');
    await startedListener!({ chatroomId, role: 'builder', reason: 'user.start' } as never);
    await vi.waitFor(() => expect(resumeTurnForSlot).toHaveBeenCalledTimes(2));
    expect(resumeTurnForSlot.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ role: 'builder' })
    );
    expect(claims).toHaveBeenCalledTimes(2);
    expect(backendStatuses.get(builderTask.taskId)).toBe('in_progress');
    expect(startCalls).toBe(0);
    expect(taskService).toBeDefined();
    await bootManager.disposeAndDrain();
  });

  test('explicit user.restart delivers one pending task after the process is ready', async () => {
    const chatroomId = 'room_1';
    const role = 'builder';
    const taskSnapshot = createTaskState();
    taskSnapshot.replaceAll([]);
    const task = taskSnapshot.mergeSignal(
      taskDocToSignal(
        makePostAgentEndSnapshotDoc({
          taskId: 'task_restart_pending' as Id<'chatroom_tasks'>,
          taskStatus: 'pending',
        })
      )
    )!;
    const taskWithContent = makeFullTaskFromSnapshot(task);
    const inbox = new TaskInboxState();
    inbox.replace([task]);
    const backendStatuses = new Map<string, string>([[task.taskId, 'pending']]);
    const claims = vi.fn(async (args: Record<string, unknown>) => {
      expect(backendStatuses.get(String(args.taskId))).toBe('pending');
      backendStatuses.set(task.taskId, 'in_progress');
    });
    const resumeTurnForSlot = vi.fn(async (_args: Record<string, unknown>) => undefined);
    const slot = { current: makeNativeSlot('idle') };
    const stopIntent = new Set([role]);
    let acquiredSlots = 0;
    let taskListener:
      | ((notification: {
          kind: 'inbox-event' | 'periodic-reconcile';
          event?: never;
          task?: never;
        }) => Promise<unknown>)
      | undefined;
    const logEvents: Record<string, unknown>[] = [];
    const backend = {
      mutation: vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
        if (typeof args.taskId === 'string' && backendStatuses.get(args.taskId) === 'pending') {
          await claims(args);
        }
        return { cleared: true, recorded: true, processed: true, marked: true };
      }),
      query: vi.fn(async (_fn: unknown, args: Record<string, unknown>) => {
        if ('machineId' in args && 'taskId' in args && !('chatroomId' in args)) {
          return taskWithContent;
        }
        if ('chatroomId' in args && 'taskId' in args) return { fullCliOutput: 'RESTART OUTPUT' };
        throw new Error(`Unexpected query with keys: ${Object.keys(args).join(',')}`);
      }),
    };
    const execution = {
      runSerializedForAgent: async (_key: unknown, operation: () => Promise<unknown>) =>
        operation(),
      ensureRunning: async () => {
        throw new Error('delivery acquisition must not autonomously start a process');
      },
      stop: async () => ({ success: true }),
      handleExit: async () => undefined,
      reset: async () => undefined,
      getSlot: () => slot.current,
      isStopRequested: () => stopIntent.has(role),
      listActive: () =>
        slot.current.state === 'running' ? [{ chatroomId, role, slot: slot.current }] : [],
      clearStuckStoppingSlot: async () => false,
      whenTurnEndsIdle: async () => undefined,
      resumeTurnForSlot,
      subscribeAgentTurnEnded: () => () => undefined,
      subscribeAgentStarted: () => () => undefined,
      subscribeAgentSessionLost: () => () => undefined,
      subscribeAgentTurnProgress: () => () => undefined,
    };
    const managerService = createAgentProcessManagerService({
      execution: execution as never,
      commandBus: { send: vi.fn() } as never,
      notifier: { subscribe: () => () => undefined } as never,
    });
    const taskService = {
      subscribe: (listener: (notification: never) => Promise<unknown>) => {
        taskListener = listener as typeof taskListener;
        return () => {
          taskListener = undefined;
        };
      },
      startTaskInbox: async () => undefined,
      stopTaskInbox: () => undefined,
      listTasksForRole: (room: string, taskRole: string) =>
        inbox.listForRole(room, taskRole as never),
      listAllTasks: () => inbox.listAll(),
      taskInboxState: inbox,
      recoverInFlightTasks: vi.fn(
        async (args: { chatroomId: string; role: string; mode: string }) => {
          expect(args).toEqual({ chatroomId, role, mode: 'explicit' });
          expect(slot.current.state).toBe('idle');
          expect(inbox.getForRole(chatroomId, role, task.taskId)?.status).toBe('pending');
          return { released: 0, skipped: 0 };
        }
      ),
      loadAssignedTaskForAction: vi.fn(async () => taskWithContent),
      recordDeliveryFailure: vi.fn(),
      clearDeliveryFailure: vi.fn(),
      recordUncoveredTurnEnd: vi.fn(async () => ({ exceeded: false })),
      releaseTaskAfterTurnFailure: vi.fn(),
      getLatestHandoff: vi.fn(async () => null),
      isRedeliveryExhausted: vi.fn(() => false),
      clearRedeliveryTracking: vi.fn(),
      forgetStaleTask: vi.fn(),
      handleAgentTurnProgress: vi.fn(),
      explainNativeDeliveryBlock: () => null,
    };
    const workManager = new AgentWorkManager({
      configurationService: {
        get: () => ({
          agentHarness: 'cursor-sdk',
          model: 'test-model',
          workingDir: '/test/workspace',
        }),
      } as never,
      agentMgr: {
        getSlot: () => slot.current,
        isStopRequested: () => stopIntent.has(role),
        resumeTurnForSlot: (args: never) => Effect.promise(() => resumeTurnForSlot(args)),
        subscribeAgentStarted: () => () => undefined,
        subscribeAgentTurnEnded: () => () => undefined,
        subscribeAgentSessionLost: () => () => undefined,
        subscribeAgentTurnProgress: () => () => undefined,
      } as never,
      runSerializedForAgent: managerService.runSerializedForAgent.bind(managerService),
      acquireNativeDeliverySlot: async (input) => {
        acquiredSlots += 1;
        return managerService.acquireNativeDeliverySlot(input);
      },
      sessionDeps: {
        sessionId: SESSION_ID,
        convexUrl: 'http://test:3210',
        machineId: MACHINE_ID,
        backend,
      } as never,
      machineId: MACHINE_ID,
      taskInboxState: inbox,
      agentTaskState: createAgentTaskStateService(),
      lifecycleOutbox: { enqueue: async (fact) => logEvents.push(fact as Record<string, unknown>) },
      taskService: taskService as never,
    });
    const inboxEvent = {
      kind: 'inbox-event' as const,
      event: {
        eventId: 'restart-pending-inbox',
        machineId: MACHINE_ID,
        chatroomId,
        taskId: task.taskId,
        role,
        eventType: WorkspaceTaskInboxEventType.TaskUpdated,
        status: 'pending',
        createdAt: Date.now(),
        task: {},
      },
    };
    const session = {
      sessionId: SESSION_ID,
      machineId: MACHINE_ID,
      convexUrl: 'http://test:3210',
      backend,
      logEvent: async (event: Record<string, unknown>) => {
        logEvents.push(event);
      },
    };

    const confirmation = await taskListener!(inboxEvent as never);
    await taskListener!({ kind: 'periodic-reconcile', task } as never);
    expect(confirmation).toEqual({ handledEventIds: ['restart-pending-inbox'] });
    expect(inbox.getForRole(chatroomId, role, task.taskId)?.status).toBe('pending');
    expect(backendStatuses.get(task.taskId)).toBe('pending');
    expect(acquiredSlots).toBe(0);
    expect(claims).not.toHaveBeenCalled();
    expect(resumeTurnForSlot).not.toHaveBeenCalled();

    const lifecycleCalls: string[] = [];
    await runRestartOrchestrator(
      {
        session,
        agentMgr: { getSlot: () => slot.current } as never,
        runSerializedForAgent: async (
          _key: AgentKey,
          _options: SerializedAgentOperationOptions,
          operation: (
            ops: SerializedAgentOperations,
            context: SerializedAgentOperationContext
          ) => Promise<unknown>
        ) =>
          operation(
            {
              stopAgent: async () => {
                lifecycleCalls.push('stop');
                slot.current = makeNativeSlot('idle');
                return { success: true };
              },
              startAgent: async (input) => {
                lifecycleCalls.push('start');
                expect(input.reason).toBe(AgentStartReasonCode.USER_RESTART);
                stopIntent.delete(role);
                slot.current = makeNativeSlot('running', 301);
                return { success: true, pid: 301 };
              },
            },
            { signal: new AbortController().signal }
          ),
        nativeDelivery: workManager,
      } as never,
      {
        chatroomId,
        role,
        agentHarness: 'cursor-sdk',
        model: 'test-model',
        workingDir: '/test/workspace',
        correlationId: 'restart-pending-task',
        wantResume: false,
      }
    );

    expect(lifecycleCalls).toEqual(['stop', 'start']);
    expect(taskService.recoverInFlightTasks).toHaveBeenCalledWith({
      chatroomId,
      role,
      mode: 'explicit',
    });
    expect(acquiredSlots).toBe(1);
    expect(claims).toHaveBeenCalledTimes(1);
    expect(resumeTurnForSlot).toHaveBeenCalledTimes(1);
    expect(backendStatuses.get(task.taskId)).toBe('in_progress');
    const restartCompleted = logEvents.find((event) => event.type === 'agent.restartCompleted');
    expect(restartCompleted).toEqual(expect.objectContaining({ deliveredTaskIds: [task.taskId] }));

    const laterConfirmation = await taskListener!(inboxEvent as never);
    await taskListener!({ kind: 'periodic-reconcile', task } as never);
    expect(laterConfirmation).toEqual({ handledEventIds: ['restart-pending-inbox'] });
    expect(acquiredSlots).toBe(1);
    expect(claims).toHaveBeenCalledTimes(1);
    expect(resumeTurnForSlot).toHaveBeenCalledTimes(1);
    await workManager.disposeAndDrain();
  });

  test('coordinator injects promoted pending task when participant is idle-after-complete', async () => {
    const snapshot = createTaskState();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(taskDocToSignal(makePostAgentEndSnapshotDoc()));
    expect(row).toBeDefined();

    const backendMutation = vi.fn().mockResolvedValue({ cleared: true, recorded: true });
    const resumeTurnForSlot = vi.fn().mockResolvedValue(undefined);
    const lifecycleEnqueue = vi.fn().mockResolvedValue(undefined);
    const agentMgr = {
      getSlot: vi.fn().mockReturnValue({
        state: 'running',
        pid: 42_424,
        harnessSessionId: HARNESS_SESSION_ID,
        nativeTurnPhase: 'idle',
      }),
      resumeTurnForSlot,
    } as unknown as DaemonAgentProcessManagerServiceShape;

    const coordinator = new NativeTaskDeliveryCoordinator();
    coordinator.reconcileRoleTasks(
      withTestTaskService({
        tasks: [row!],
        agentMgr,
        runSerializedForAgent: vi.fn() as never,
        sessionDeps: {
          sessionId: SESSION_ID,
          convexUrl: 'http://test:3210',
          machineId: MACHINE_ID,
          logEvent: async () => undefined,
          backend: {
            mutation: backendMutation,
            query: vi.fn(async (fn, args) => {
              if (args && 'machineId' in args && !('chatroomId' in args)) {
                return makeFullTaskFromSnapshot(row!);
              }
              if (args && 'chatroomId' in args) {
                return { fullCliOutput: 'DELIVERY OUTPUT' };
              }
              throw new Error(`Unexpected query: ${String(fn)}`);
            }),
          },
        } satisfies NativeTaskDeliverySessionDeps,
        machineId: MACHINE_ID,
        lifecycleOutbox: { enqueue: lifecycleEnqueue },
        isTaskActive: () => false,
      })
    );

    await vi.waitFor(() => {
      expect(resumeTurnForSlot).toHaveBeenCalled();
    });

    expect(resumeTurnForSlot).toHaveBeenCalledWith({
      chatroomId: row!.chatroomId,
      role: 'builder',
      prompt: buildNativeInjectionPrompt({
        taskDeliveryOutput: 'DELIVERY OUTPUT',
        augmentationMode: resolveSessionAugmentationForTask(
          { content: '## Goal\nQueued follow-up after agent_end', startInNewSession: undefined },
          'builder'
        ),
      }),
    });
    expect(lifecycleEnqueue).toHaveBeenCalledWith(
      expect.objectContaining({ action: NATIVE_TASK_INJECTED_ACTION, taskId: row!.taskId })
    );
  });

  test('shouldDeliverNativeTask true for post-agent_end participant shape', () => {
    const snapshot = createTaskState();
    snapshot.replaceAll([]);
    const row = snapshot.mergeSignal(taskDocToSignal(makePostAgentEndSnapshotDoc()));
    expect(row).toBeDefined();

    const slot = {
      state: 'running' as const,
      pid: 42_424,
      harnessSessionId: HARNESS_SESSION_ID,
      nativeTurnPhase: 'idle' as const,
    };
    expect(shouldDeliverNativeTask(row!, { slot })).toBe(true);
  });
});
