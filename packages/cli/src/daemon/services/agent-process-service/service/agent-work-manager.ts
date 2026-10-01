// fallow-ignore-file complexity

import { AgentStopReasonEnum } from '@workspace/backend/src/domain/entities/agent.js';
import { WorkspaceTaskInboxEventType } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { Effect } from 'effect';

import {
  buildAgentLifecycleRevisionKey,
  buildAgentStatusFact,
  type AgentLifecycleFact,
} from '../../../domain/entities/agent-lifecycle-fact.js';
import { AGENT_SLOT_STATE } from '../../../domain/entities/agent-slot.js';
import type { AssignedTask } from '../../../domain/entities/assigned-task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../../entry/daemon-services.js';
import type { TaskInboxStateReader } from '../../../infrastructure/inbox/task-inbox-state.js';
import type { AgentConfigRegistry } from '../../chatroom-workspace-configuration-service/index.js';
import type {
  AgentStartedEvent,
  AgentSessionLostEvent,
  AgentTurnEndedEvent,
  AgentTurnDisposition,
  AgentTaskStateService,
  AgentProcessManagerService,
  NativeDeliverySessionHandles,
  TaskService,
} from '../../service-interfaces.js';
import {
  explainNativeDeliveryBlock,
  isNativeHarness,
} from '../../task-service/domain/usecase/native-task-injector-logic.js';
import type {
  TaskServiceDeliveryConfirmation,
  TaskServiceNotification,
} from '../../task-service/index.js';
import { createConvexNativeTaskDeliveryGateway } from '../../task-service/infrastructure/adapters/convex-native-task-delivery-gateway.js';
import { createDaemonAuditPort } from '../../task-service/infrastructure/adapters/daemon-audit-port.js';
import { getRoleDeliveryState } from '../../task-service/service/native-delivery/role-delivery-state.js';
import {
  processTasksUpdate,
  type TaskDeliveryLifecycleArgs,
} from '../../task-service/service/native-delivery/task-delivery-processor.js';
import type { TaskDeliveryService } from '../../task-service/service/native-delivery/task-delivery-service.js';
import { NativeTaskDeliveryQueue } from '../../task-service/service/native-task-delivery-queue.js';
import { runNativeInjectionEffect } from '../../task-service/service/native-task-injector.js';

export type AgentWorkPass =
  | 'inbox-event'
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'agent-session-lost'
  | 'agent-started'
  | 'turn-ended'
  | 'restart-completed';

export type AgentTaskDeliveredHandler = (args: TaskDeliveryLifecycleArgs) => void;

export interface AgentWorkManagerDependencies {
  /** Workspace configuration source for delivery-time agent runtime config. */
  readonly configurationService: AgentConfigRegistry;
  readonly agentMgr: DaemonAgentProcessManagerServiceShape;
  readonly runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
  readonly acquireNativeDeliverySlot: AgentProcessManagerService['acquireNativeDeliverySlot'];
  readonly sessionDeps: NativeDeliverySessionHandles & { convexUrl: string };
  readonly machineId: string;
  /** Read-only task inbox state owned and mutated by TaskService. */
  readonly taskInboxState: TaskInboxStateReader;
  readonly agentTaskState: AgentTaskStateService;
  readonly lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
  readonly taskService: TaskService;
}

type RoleRecoveryGate = {
  readonly drainPromise: Promise<void>;
  readonly completion: Promise<void>;
  readonly resolveCompletion: () => void;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  retryAttempts: number;
  recoveryPromise: Promise<{ released: number }> | undefined;
};

const recoveryKey = (chatroomId: string, role: string): string =>
  `${chatroomId}:${role.toLowerCase()}`;

/**
 * Per-daemon native delivery application service.
 *
 * This is the composition boundary for task inbox updates. Callers provide a
 * constructed instance instead of resolving delivery dependencies through the
 * module-level session registry.
 */
export class AgentWorkManager {
  private readonly unsubscribeAgentTurnEnded: () => void;
  private readonly unsubscribeAgentStarted: () => void;
  private readonly unsubscribeAgentSessionLost: () => void;
  private readonly unsubscribeAgentTurnProgress: () => void;
  private readonly reconcileStates = new Map<
    string,
    {
      pendingSource: AgentWorkPass | undefined;
      promise: Promise<readonly string[]>;
    }
  >();
  private unsubscribeTaskService: (() => void) | undefined;
  private readonly nativeTaskDeliveryQueue: NativeTaskDeliveryQueue;
  private readonly deliveryTaskService: TaskDeliveryService;
  private readonly recoveryGates = new Map<string, RoleRecoveryGate>();
  private disposed = false;

  constructor(private readonly deps: AgentWorkManagerDependencies) {
    const gateway = createConvexNativeTaskDeliveryGateway(deps.sessionDeps.backend);
    const audit = createDaemonAuditPort(deps.sessionDeps.logEvent ?? (async () => undefined));
    this.nativeTaskDeliveryQueue = new NativeTaskDeliveryQueue(async (entry) => {
      await Effect.runPromise(
        runNativeInjectionEffect(entry.task, entry.harnessSessionId, {
          ...deps.sessionDeps,
          convexUrl: deps.sessionDeps.convexUrl,
          configurationService: deps.configurationService,
          agentMgr: {
            resumeTurnForSlot: (args) => Effect.runPromise(deps.agentMgr.resumeTurnForSlot(args)),
            getSlot: (chatroomId, role) => deps.agentMgr.getSlot(chatroomId, role),
            isStopRequested: (chatroomId, role) => deps.agentMgr.isStopRequested(chatroomId, role),
          },
          taskGateway: gateway,
          audit,
          runSerializedForAgent: deps.runSerializedForAgent,
          lifecycleOutbox: deps.lifecycleOutbox,
          onTaskDelivered: entry.onTaskDelivered,
          ...(entry.isCurrent ? { isCurrent: entry.isCurrent } : {}),
        })
      );
    });
    this.deliveryTaskService = {
      isNativeHarness,
      explainNativeDeliveryBlock,
      releaseTaskAfterTurnFailure: deps.taskService.releaseTaskAfterTurnFailure,
      recordDeliveryFailure: deps.taskService.recordDeliveryFailure,
      clearDeliveryFailure: deps.taskService.clearDeliveryFailure,
      recordUncoveredTurnEnd: deps.taskService.recordUncoveredTurnEnd,
      isRedeliveryExhausted: deps.taskService.isRedeliveryExhausted,
      clearRedeliveryTracking: deps.taskService.clearRedeliveryTracking,
      forgetStaleTask: deps.taskService.forgetStaleTask,
      loadAssignedTaskForAction: deps.taskService.loadAssignedTaskForAction,
      deliverNativeTask: (task, harnessSessionId, onTaskDelivered, isCurrent) =>
        this.nativeTaskDeliveryQueue.enqueue({
          task,
          harnessSessionId,
          onTaskDelivered,
          isCurrent,
        }),
    };
    this.unsubscribeAgentTurnEnded = deps.agentMgr.subscribeAgentTurnEnded((event) =>
      this.handleAgentTurnEnded(event)
    );
    this.unsubscribeAgentStarted = deps.agentMgr.subscribeAgentStarted((event) =>
      this.handleAgentStarted(event)
    );
    this.unsubscribeAgentSessionLost = deps.agentMgr.subscribeAgentSessionLost((event) =>
      this.handleAgentSessionLost(event)
    );
    this.unsubscribeAgentTurnProgress = deps.agentMgr.subscribeAgentTurnProgress((event) => {
      const activeTask = this.deps.agentTaskState.get(event);
      if (!activeTask) return;
      void this.deps.taskService
        .handleAgentTurnProgress({ ...event, taskId: activeTask.taskId })
        .catch((error: unknown) => {
          console.warn(
            `[AgentProcessManager] turn-progress handling failed for ${event.role}@${event.chatroomId}: ${error instanceof Error ? error.message : String(error)}`
          );
        });
    });
    this.unsubscribeTaskService = deps.taskService.subscribe((notification) =>
      this.handleTaskServiceNotification(notification)
    );
  }

  async handleAgentStarted(event: AgentStartedEvent): Promise<void> {
    await this.waitForRoleRecovery(event.chatroomId, event.role);
    // A new agent process/session cannot still be executing the task recorded
    // by the previous process. Clear the local dedup marker before the first
    // post-start reconciliation so a stop/start cycle can recover delivery.
    this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
    // A user-initiated agent restart is an explicit intervention: reset the V2
    // redelivery attempt cap so delivery can be retried (plan V2).
    if (event.reason === 'user.start') {
      this.deps.taskService.clearRedeliveryTracking({
        chatroomId: event.chatroomId,
        role: event.role,
      });
    }
    await this.requestReconcile({
      chatroomId: event.chatroomId,
      role: event.role,
      source: 'agent-started',
    });
  }

  private canReconcileRole(chatroomId: string, role: string): boolean {
    if (this.deps.agentMgr.isStopRequested(chatroomId, role)) return false;
    const slot = this.deps.agentMgr.getSlot(chatroomId, role);
    return (
      slot?.state === AGENT_SLOT_STATE.SPAWNING ||
      (slot?.state === AGENT_SLOT_STATE.RUNNING && slot.pid !== undefined)
    );
  }

  handleAgentSessionLost(event: AgentSessionLostEvent): void {
    if (this.disposed) return;
    const slot = this.deps.agentMgr.getSlot(event.chatroomId, event.role);
    if (
      slot?.pid !== event.pid ||
      (event.harnessSessionId !== undefined && slot?.harnessSessionId !== event.harnessSessionId)
    )
      return;
    const key = recoveryKey(event.chatroomId, event.role);
    if (this.recoveryGates.has(key)) return;
    void this.prepareRoleRecovery({ chatroomId: event.chatroomId, role: event.role })
      .then(() =>
        this.recoverStoppedRole({
          chatroomId: event.chatroomId,
          role: event.role,
          mode: 'automatic',
        })
      )
      .catch((error: unknown) => {
        console.warn(
          `[AgentWorkManager] recovery failed room=${event.chatroomId} role=${event.role} phase=automatic error=${error instanceof Error ? error.message : String(error)}`
        );
        this.scheduleRecoveryRetry(event.chatroomId, event.role);
      });
  }

  async prepareRoleRecovery(args: { chatroomId: string; role: string }): Promise<void> {
    const key = recoveryKey(args.chatroomId, args.role);
    const existing = this.recoveryGates.get(key);
    if (existing) return existing.drainPromise;
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    getRoleDeliveryState().resetDeliveryState(args.chatroomId, args.role);
    const drainPromise = this.nativeTaskDeliveryQueue.invalidateRole(args.chatroomId, args.role);
    const gate: RoleRecoveryGate = {
      drainPromise,
      completion,
      resolveCompletion,
      retryAttempts: 0,
      retryTimer: undefined,
      recoveryPromise: undefined,
    };
    this.recoveryGates.set(key, gate);
    await drainPromise;
    if (this.recoveryGates.get(key) === gate) {
      this.deps.agentTaskState.clear(args);
    }
  }

  async recoverStoppedRole(args: {
    chatroomId: string;
    role: string;
    mode: 'automatic' | 'explicit';
  }): Promise<{ released: number }> {
    const key = recoveryKey(args.chatroomId, args.role);
    const gate = this.recoveryGates.get(key);
    if (!gate)
      throw new Error(`role recovery gate not prepared for ${args.role}@${args.chatroomId}`);
    if (gate.recoveryPromise) return gate.recoveryPromise;
    gate.recoveryPromise = (async () => {
      await gate.drainPromise;
      const result = await this.deps.taskService.recoverInFlightTasks(args);
      if (this.recoveryGates.get(key) === gate) {
        if (gate.retryTimer) clearTimeout(gate.retryTimer);
        this.recoveryGates.delete(key);
        gate.resolveCompletion();
        if (!this.disposed) {
          void this.requestReconcile({
            chatroomId: args.chatroomId,
            role: args.role,
            source: 'agent-session-lost',
          }).catch((error: unknown) => {
            console.warn(
              `[AgentWorkManager] post-recovery reconcile failed room=${args.chatroomId} role=${args.role}: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }
      }
      return { released: result.released };
    })();
    try {
      return await gate.recoveryPromise;
    } finally {
      gate.recoveryPromise = undefined;
    }
  }

  private async waitForRoleRecovery(chatroomId: string, role: string): Promise<void> {
    while (true) {
      const gate = this.recoveryGates.get(recoveryKey(chatroomId, role));
      if (!gate) return;
      await gate.completion;
    }
  }

  private scheduleRecoveryRetry(chatroomId: string, role: string): void {
    const gate = this.recoveryGates.get(recoveryKey(chatroomId, role));
    if (!gate || gate.retryTimer || this.disposed) return;
    const delay = Math.min(30_000, 1_000 * 2 ** gate.retryAttempts++);
    gate.retryTimer = setTimeout(() => {
      gate.retryTimer = undefined;
      void this.recoverStoppedRole({ chatroomId, role, mode: 'automatic' }).catch(
        (error: unknown) => {
          console.warn(
            `[AgentWorkManager] recovery retry failed room=${chatroomId} role=${role} phase=automatic error=${error instanceof Error ? error.message : String(error)}`
          );
          this.scheduleRecoveryRetry(chatroomId, role);
        }
      );
    }, delay);
  }

  /**
   * Plan V2 shared turn-end recovery: counts the uncovered turn end toward the
   * consecutive-attempt cap, then releases the task unless the cap is hit.
   * Returns the outcome so each call site applies its own disposition
   * (`exceeded` keeps the task parked; a release failure holds the slot).
   */
  private async recoverTaskAfterUncoveredTurnEnd(
    event: AgentTurnEndedEvent,
    activeTask: { taskId: string },
    phase: 'turn-failed' | 'turn-ended'
  ): Promise<'released' | 'exceeded' | 'recovery-failed'> {
    const { chatroomId, role } = event;
    const { exceeded } = await this.deps.taskService.recordUncoveredTurnEnd({
      chatroomId,
      role,
      taskId: activeTask.taskId,
    });
    if (exceeded) return 'exceeded';

    try {
      await this.deps.taskService.releaseTaskAfterTurnFailure({
        chatroomId,
        role,
        taskId: activeTask.taskId,
      });
    } catch (error) {
      console.error(
        `[NativeDelivery:${phase}-recovery-error] chatroom=${chatroomId} role=${role} task=${activeTask.taskId} turn=${event.completion.turnId} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      );
      return 'recovery-failed';
    }
    return 'released';
  }

  async handleAgentTurnEnded(event: AgentTurnEndedEvent): Promise<AgentTurnDisposition> {
    const completion = event.completion;
    if (completion.status !== 'completed') {
      const activeTask = this.deps.agentTaskState.get({
        chatroomId: event.chatroomId,
        role: event.role,
      });
      const errorDetail = completion.error;
      console.error(
        `[NativeDelivery:turn-failed] chatroom=${event.chatroomId} role=${event.role} task=${activeTask?.taskId ?? 'none'} turn=${completion.turnId} status=${completion.status} source=${completion.source} error=${errorDetail ?? 'none'}`
      );
      if (activeTask) {
        // Plan V2: a failed turn without a covering handoff counts toward the
        // consecutive-attempt cap; at the cap the release is skipped and the
        // task is parked with a user-visible delivery failure.
        const recovery = await this.recoverTaskAfterUncoveredTurnEnd(
          event,
          activeTask,
          'turn-failed'
        );
        if (recovery === 'exceeded') {
          this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
          return { kind: 'release-slot' };
        }
        if (recovery === 'recovery-failed') {
          return { kind: 'hold-slot', reason: 'task-recovery-failed' };
        }
        this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
      }
      const fact: AgentLifecycleFact = {
        kind: 'turn_failed',
        chatroomId: event.chatroomId,
        role: event.role,
        ...(activeTask?.taskId ? { taskId: activeTask.taskId } : {}),
        ...(event.slot.harnessSessionId ? { harnessSessionId: event.slot.harnessSessionId } : {}),
        turnId: completion.turnId,
        status: completion.status,
        source: completion.source,
        ...(errorDetail ? { error: errorDetail } : {}),
        revisionKey: buildAgentLifecycleRevisionKey('turn_failed', {
          chatroomId: event.chatroomId,
          role: event.role,
          turnId: completion.turnId,
        }),
        emittedAt: Date.now(),
      };
      try {
        // Await only local persistence. A projection failure cannot hold an idle slot.
        await this.deps.lifecycleOutbox.enqueue(fact);
      } catch (error) {
        console.error(
          `[NativeDelivery:turn-failed-outbox-error] chatroom=${event.chatroomId} role=${event.role} turn=${completion.turnId} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
        );
      }
      return { kind: 'release-slot' };
    }
    // A completed turn without a durable handoff must release its active task.
    // This replaces the backend agent.exited release while keeping the decision
    // scoped to the task owned by this daemon/session.
    const activeTask = this.deps.agentTaskState.get({
      chatroomId: event.chatroomId,
      role: event.role,
    });
    if (activeTask) {
      const handoff = await this.deps.taskService.getLatestHandoff(event.chatroomId, event.role);
      if (!handoff?.taskIds.includes(activeTask.taskId)) {
        // Plan V2: consecutive uncovered turn ends are capped. At the cap the
        // task stays in its backend status (no release), a `redelivery_exhausted`
        // delivery failure was recorded once by the task service, and the
        // delivery decision skips the task until fresh task activity or a
        // user-initiated agent restart resets the cycle.
        const recovery = await this.recoverTaskAfterUncoveredTurnEnd(
          event,
          activeTask,
          'turn-ended'
        );
        if (recovery === 'recovery-failed') {
          return { kind: 'hold-slot', reason: 'task-recovery-failed' };
        }
      }
    }
    // Clear after the durable handoff check/release so the next reconcile can
    // deliver the task when needed.
    this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
    try {
      await this.deps.lifecycleOutbox.enqueue(
        buildAgentStatusFact({
          chatroomId: event.chatroomId,
          role: event.role,
          status: 'waiting',
        })
      );
    } catch (error) {
      console.error(
        `[NativeDelivery:turn-ended-outbox-error] chatroom=${event.chatroomId} role=${event.role} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      );
    }
    // The manager invokes this handler while the agent's lifecycle operation
    // is still serialized. Schedule delivery for the next turn of the event
    // loop so it cannot attempt to inject while that operation still owns the
    // per-agent boundary.
    this.scheduleRoleDelivery(event.chatroomId, event.role);
    return { kind: 'release-slot' };
  }

  private scheduleRoleDelivery(chatroomId: string, role: string): void {
    setTimeout(() => {
      void this.requestReconcile({ chatroomId, role, source: 'turn-ended' }).catch(
        (error: unknown) => {
          console.warn(
            `[NativeDelivery] post-turn delivery failed for ${role}@${chatroomId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      );
    }, 0);
  }

  dispose(): void {
    this.disposed = true;
    for (const gate of this.recoveryGates.values()) {
      if (gate.retryTimer) clearTimeout(gate.retryTimer);
      gate.retryTimer = undefined;
      void gate.drainPromise.catch(() => undefined);
      void gate.recoveryPromise?.catch(() => undefined);
      gate.resolveCompletion();
    }
    this.recoveryGates.clear();
    this.unsubscribeAgentTurnEnded();
    this.unsubscribeAgentStarted();
    this.unsubscribeAgentSessionLost();
    this.unsubscribeAgentTurnProgress();
    this.unsubscribeTaskService?.();
    this.unsubscribeTaskService = undefined;
    this.nativeTaskDeliveryQueue.stop();
  }

  async disposeAndDrain(): Promise<void> {
    this.dispose();
    await this.nativeTaskDeliveryQueue.stopAndDrain();
  }

  get agentTaskState(): AgentTaskStateService {
    return this.deps.agentTaskState;
  }

  async handleTaskServiceNotification(
    notification: TaskServiceNotification
  ): Promise<TaskServiceDeliveryConfirmation | void> {
    if (notification.kind === 'bootstrap') {
      await this.requestReconcileForTasks(notification.tasks, 'bootstrap');
      return;
    }
    if (notification.kind === 'periodic-reconcile') {
      if (
        !this.canReconcileRole(notification.task.chatroomId, notification.task.agentConfig.role)
      ) {
        return;
      }
      const taskLookup = {
        chatroomId: notification.task.chatroomId,
        role: notification.task.agentConfig.role,
        taskId: notification.task.taskId,
      };
      const currentTask = await this.deliveryTaskService.loadAssignedTaskForAction(taskLookup);
      if (!currentTask) {
        this.deliveryTaskService.forgetStaleTask(taskLookup);
        console.warn(
          `[NativeDelivery:stale-task] chatroom=${taskLookup.chatroomId} role=${taskLookup.role} task=${taskLookup.taskId} reason=periodic_authoritative_task_missing`
        );
        return;
      }
      await this.requestReconcile({
        chatroomId: notification.task.chatroomId,
        role: notification.task.agentConfig.role,
        source: 'periodic-reconcile',
      });
      return;
    }
    if (notification.event.eventType === WorkspaceTaskInboxEventType.TaskDeleted) {
      await this.cancelTaskWork(
        notification.event.chatroomId,
        notification.event.role,
        notification.event.taskId
      );
    }
    if (notification.event.eventType === WorkspaceTaskInboxEventType.TaskDeleted) {
      return { handledEventIds: [notification.event.eventId] };
    }
    const currentTask = this.deps.taskInboxState.getForRole(
      notification.event.chatroomId,
      notification.event.role,
      notification.event.taskId
    );
    if (
      !currentTask ||
      (currentTask.status !== 'pending' && currentTask.status !== 'acknowledged')
    ) {
      if (currentTask) {
        await this.clearExpectedTaskDeliveryFailure(currentTask.taskId);
      }
      return { handledEventIds: [notification.event.eventId] };
    }
    if (!this.canReconcileRole(notification.event.chatroomId, notification.event.role)) {
      return { handledEventIds: [notification.event.eventId] };
    }
    if (
      this.deps.agentTaskState.get({
        chatroomId: notification.event.chatroomId,
        role: notification.event.role,
      })?.taskId === notification.event.taskId
    ) {
      return { handledEventIds: [notification.event.eventId] };
    }
    const taskLookup = {
      chatroomId: notification.event.chatroomId,
      role: notification.event.role,
      taskId: notification.event.taskId,
    };
    const authoritativeTask = await this.deliveryTaskService.loadAssignedTaskForAction(taskLookup);
    if (!authoritativeTask) {
      this.deliveryTaskService.forgetStaleTask(taskLookup);
      console.warn(
        `[NativeDelivery:stale-task] chatroom=${taskLookup.chatroomId} role=${taskLookup.role} task=${taskLookup.taskId} reason=inbox_authoritative_task_missing`
      );
      return { handledEventIds: [notification.event.eventId] };
    }
    const deliveredTaskIds = await this.requestReconcile({
      chatroomId: notification.event.chatroomId,
      role: notification.event.role,
      source: 'inbox-event',
    });
    return { deliveredTaskIds };
  }

  private async clearExpectedTaskDeliveryFailure(taskId: string): Promise<void> {
    try {
      await this.deliveryTaskService.clearDeliveryFailure(taskId, 'task_not_deliverable');
    } catch (error) {
      console.warn(
        `[AgentWorkManager] failed to clear stale task delivery failure task=${taskId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async cancelTaskWork(chatroomId: string, role: string, taskId: string): Promise<void> {
    const activeTask = this.deps.agentTaskState.get({ chatroomId, role });
    if (activeTask?.taskId !== taskId) return;

    this.deps.agentTaskState.clear({ chatroomId, role });
    const slot = this.deps.agentMgr.getSlot(chatroomId, role);
    if (!slot || slot.state === AGENT_SLOT_STATE.IDLE || slot.state === AGENT_SLOT_STATE.STOPPING)
      return;

    try {
      await this.deps.runSerializedForAgent(
        { chatroomId, role },
        { timeoutMs: 120_000 },
        (ops, context) =>
          ops.stopAgent(
            {
              chatroomId,
              role,
              reason: AgentStopReasonEnum['platform.task_cancelled'],
              ...(slot.pid === undefined ? {} : { pid: slot.pid }),
            },
            context.signal
          )
      );
    } catch (error) {
      console.warn(
        `[AgentWorkManager] task cancellation stop failed for ${role}@${chatroomId} task=${taskId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async requestReconcile(params: {
    chatroomId: string;
    role: string;
    source: AgentWorkPass;
    onTaskDelivered?: AgentTaskDeliveredHandler;
  }): Promise<readonly string[]> {
    if (this.disposed || !this.canReconcileRole(params.chatroomId, params.role)) return [];
    const key = `${params.chatroomId}:${params.role.toLowerCase()}`;
    const existing = this.reconcileStates.get(key);
    if (existing) {
      existing.pendingSource = params.source;
      return existing.promise;
    }

    const state: {
      pendingSource: AgentWorkPass | undefined;
      promise: Promise<readonly string[]>;
    } = {
      pendingSource: undefined,
      promise: Promise.resolve([]),
    };
    // fallow-ignore-next-line complexity
    state.promise = (async () => {
      const delivered: string[] = [];
      try {
        do {
          if (this.disposed || !this.canReconcileRole(params.chatroomId, params.role)) {
            return delivered;
          }
          const source = state.pendingSource ?? params.source;
          state.pendingSource = undefined;
          await this.waitForRoleRecovery(params.chatroomId, params.role);
          if (this.disposed || !this.canReconcileRole(params.chatroomId, params.role)) {
            return delivered;
          }
          const generation = getRoleDeliveryState().getGeneration(params.chatroomId, params.role);
          const isCurrent = () =>
            this.canReconcileRole(params.chatroomId, params.role) &&
            !this.recoveryGates.has(key) &&
            getRoleDeliveryState().getGeneration(params.chatroomId, params.role) === generation;
          const tasks = this.deps.taskInboxState.listForRole(params.chatroomId, params.role);
          delivered.push(
            ...(await this.reconcileRole(source, tasks, params.onTaskDelivered, isCurrent))
          );
        } while (state.pendingSource !== undefined);
      } finally {
        if (this.reconcileStates.get(key) === state) this.reconcileStates.delete(key);
      }
      return delivered;
    })();
    this.reconcileStates.set(key, state);
    return state.promise;
  }

  // fallow-ignore-next-line unused-class-member
  async reconcileAfterAgentRestart(args: { chatroomId: string; role: string }): Promise<string[]> {
    const delivered: string[] = [];
    await this.requestReconcile({
      chatroomId: args.chatroomId,
      role: args.role,
      source: 'restart-completed',
      onTaskDelivered: ({ taskId }) => {
        delivered.push(taskId);
      },
    });
    return delivered;
  }

  private async requestReconcileForTasks(
    tasks: readonly AssignedTask[],
    source: AgentWorkPass
  ): Promise<void> {
    const roles = new Set(
      tasks.map((snapshot) => `${snapshot.chatroomId}:${snapshot.agentConfig.role.toLowerCase()}`)
    );
    await Promise.all(
      [...roles].map((key) => {
        const separator = key.indexOf(':');
        return this.requestReconcile({
          chatroomId: key.slice(0, separator),
          role: key.slice(separator + 1),
          source,
        });
      })
    );
  }

  private async reconcileRole(
    pass: AgentWorkPass,
    tasks: readonly AssignedTask[],
    onTaskDelivered?: AgentTaskDeliveredHandler,
    isCurrent: () => boolean = () => true
  ): Promise<readonly string[]> {
    if (tasks.length === 0) return [];
    return processTasksUpdate(
      this.deliveryTaskService,
      this.deps.configurationService,
      pass,
      ({ chatroomId, role, taskId }) =>
        this.deps.agentTaskState.get({ chatroomId, role })?.taskId === taskId,
      {
        tasks,
        isCurrent,
        onTaskDeliveryStarted: (args) => this.recordTaskDeliveryStarted(args),
        onTaskDeliveryFailed: (args) => this.recordTaskDeliveryFailed(args),
        onTaskDelivered: (args) => {
          this.recordTaskDelivered(args);
          onTaskDelivered?.(args);
        },
      },
      this.deps.acquireNativeDeliverySlot
    );
  }

  recordTaskDeliveryStarted(args: TaskDeliveryLifecycleArgs): void {
    this.deps.agentTaskState.start(args);
  }

  recordTaskDeliveryFailed(args: { chatroomId: string; role: string; taskId: string }): void {
    const key = { chatroomId: args.chatroomId, role: args.role };
    if (this.deps.agentTaskState.get(key)?.taskId === args.taskId) {
      this.deps.agentTaskState.clear(key);
    }
  }

  recordTaskDelivered(args: { chatroomId: string; role: string; taskId: string }): void {
    this.deps.agentTaskState.start(args);
  }
}
