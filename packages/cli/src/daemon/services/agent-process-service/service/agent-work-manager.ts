// fallow-ignore-file complexity

import { AgentStopReasonEnum } from '@workspace/backend/src/domain/entities/agent.js';
import { WorkspaceTaskInboxEventType } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { Effect } from 'effect';

import {
  buildAgentLifecycleRevisionKey,
  type AgentLifecycleFact,
} from '../../../domain/entities/agent-lifecycle-fact.js';
import type { AssignedTaskSnapshotView } from '../../../domain/entities/assigned-task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../../entry/daemon-services.js';
import type { TaskSnapshotStateReader } from '../../../infrastructure/inbox/task-state-manager.js';
import type {
  AgentStartedEvent,
  AgentSessionLostEvent,
  AgentTurnEndedEvent,
  AgentTurnDisposition,
  AgentTaskStateService,
  AgentProcessManagerService,
  TaskService,
} from '../../service-interfaces.js';
import { snapshotRequestsNativeColdSession } from '../../task-service/domain/usecase/native-cold-session-delivery.js';
import {
  explainNativeDeliveryBlock,
  isNativeHarness,
} from '../../task-service/domain/usecase/native-task-injector-logic.js';
import type { TaskServiceNotification } from '../../task-service/index.js';
import { createConvexNativeTaskDeliveryGateway } from '../../task-service/infrastructure/adapters/convex-native-task-delivery-gateway.js';
import { createDaemonAuditPort } from '../../task-service/infrastructure/adapters/daemon-audit-port.js';
import { logNativeDeliveryDecision } from '../../task-service/service/native-delivery/native-delivery-log.js';
import type { NativeTaskDeliverySessionDeps } from '../../task-service/service/native-delivery/native-task-delivery-coordinator.js';
import { getRoleDeliveryState } from '../../task-service/service/native-delivery/role-delivery-state.js';
import {
  processTasksUpdate,
  type TaskDeliveryContext,
  type TaskDeliveryRuntime,
} from '../../task-service/service/native-delivery/task-delivery-processor.js';
import type { TaskDeliveryService } from '../../task-service/service/native-delivery/task-delivery-service.js';
import { NativeTaskDeliveryQueue } from '../../task-service/service/native-task-delivery-queue.js';
import { runNativeInjectionEffect } from '../../task-service/service/native-task-injector.js';

export type AgentWorkPass =
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'inbox-signal'
  | 'agent-session-lost'
  | 'agent-started'
  | 'turn-ended'
  | 'restart-completed';
// Compatibility aliases remain accepted by the internal delivery adapter while
// callers migrate to requestReconcile and the canonical trigger names above.
export type LegacyAgentWorkPass = 'inbox-signal' | 'restart';

export type AgentTaskDeliveredHandler = (args: {
  chatroomId: string;
  role: string;
  taskId: string;
  harnessSessionId: string;
}) => void;

export interface AgentWorkManagerDependencies {
  readonly runtime: TaskDeliveryRuntime;
  readonly effectContext: TaskDeliveryContext;
  readonly agentMgr: DaemonAgentProcessManagerServiceShape;
  readonly runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
  readonly sessionDeps: NativeTaskDeliverySessionDeps;
  readonly machineId: string;
  /** Read-only task snapshot owned and mutated by TaskService. */
  readonly taskSnapshotState: TaskSnapshotStateReader;
  readonly agentTaskState: AgentTaskStateService;
  readonly lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
  readonly taskService: TaskService;
}

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
  private readonly reconcileStates = new Map<
    string,
    {
      pendingSource: AgentWorkPass | undefined;
      promise: Promise<void>;
    }
  >();
  private unsubscribeTaskService: (() => void) | undefined;
  private readonly nativeTaskDeliveryQueue: NativeTaskDeliveryQueue;
  private readonly deliveryTaskService: TaskDeliveryService;

  constructor(private readonly deps: AgentWorkManagerDependencies) {
    const gateway = createConvexNativeTaskDeliveryGateway(deps.sessionDeps.backend);
    const audit = createDaemonAuditPort(deps.sessionDeps.logEvent ?? (async () => undefined));
    this.nativeTaskDeliveryQueue = new NativeTaskDeliveryQueue(async (entry) => {
      await Effect.runPromise(
        runNativeInjectionEffect(entry.task, entry.harnessSessionId, {
          ...deps.sessionDeps,
          convexUrl: deps.sessionDeps.convexUrl,
          agentMgr: {
            resumeTurnForSlot: (args) => Effect.runPromise(deps.agentMgr.resumeTurnForSlot(args)),
            getSlot: (chatroomId, role) => deps.agentMgr.getSlot(chatroomId, role),
          },
          taskGateway: gateway,
          audit,
          runSerializedForAgent: deps.runSerializedForAgent,
          lifecycleOutbox: deps.lifecycleOutbox,
          onTaskDelivered: entry.onTaskDelivered,
        })
      );
    });
    this.deliveryTaskService = {
      isNativeHarness,
      snapshotRequestsNativeColdSession,
      explainNativeDeliveryBlock,
      releaseTaskAfterTurnFailure: deps.taskService.releaseTaskAfterTurnFailure,
      loadAssignedTaskForAction: deps.taskService.loadAssignedTaskForAction,
      deliverNativeTask: (task, harnessSessionId, onTaskDelivered) =>
        this.nativeTaskDeliveryQueue.enqueue({ task, harnessSessionId, onTaskDelivered }),
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
    this.unsubscribeTaskService = deps.taskService.subscribe((notification) =>
      this.handleTaskServiceNotification(notification)
    );
  }

  async handleAgentStarted(event: AgentStartedEvent): Promise<void> {
    // A new agent process/session cannot still be executing the task recorded
    // by the previous process. Clear the local dedup marker before the first
    // post-start reconciliation so a stop/start cycle can recover delivery.
    this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
    await this.requestReconcile({
      chatroomId: event.chatroomId,
      role: event.role,
      source: 'agent-started',
    });
  }

  handleAgentSessionLost(event: AgentSessionLostEvent): void {
    getRoleDeliveryState().resetDeliveryState(event.chatroomId, event.role);
    this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
    void this.requestReconcile({
      chatroomId: event.chatroomId,
      role: event.role,
      source: 'agent-session-lost',
    }).catch((error: unknown) => {
      console.warn(
        `[NativeDelivery:failure] role=${event.role} chatroom=${event.chatroomId} operation=session-loss-reconcile error=${error instanceof Error ? error.message : String(error)}`
      );
    });
  }

  async handleAgentTurnEnded(event: AgentTurnEndedEvent): Promise<AgentTurnDisposition> {
    const completion = event.completion;
    if (completion && completion.status !== 'completed') {
      const activeTask = this.deps.agentTaskState.get({
        chatroomId: event.chatroomId,
        role: event.role,
      });
      const errorDetail = completion.error;
      console.error(
        `[NativeDelivery:turn-failed] chatroom=${event.chatroomId} role=${event.role} task=${activeTask?.taskId ?? 'none'} turn=${completion.turnId} status=${completion.status} source=${completion.source} error=${errorDetail ?? 'none'}`
      );
      if (activeTask) {
        try {
          await this.deps.taskService.releaseTaskAfterTurnFailure({
            chatroomId: event.chatroomId,
            role: event.role,
            taskId: activeTask.taskId,
          });
        } catch (error) {
          console.error(
            `[NativeDelivery:turn-failed-recovery-error] chatroom=${event.chatroomId} role=${event.role} task=${activeTask.taskId} turn=${completion.turnId} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
          );
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
        // The local outbox is the fire-and-forget boundary to the backend. The
        // enqueue itself is awaited so the manager receives a real disposition.
        // When a task was recovered above, the backend queue already holds it;
        // a secondary fact-enqueue failure must not re-orphan the task/slot.
        await this.deps.lifecycleOutbox.enqueue(fact);
      } catch (error) {
        console.error(
          `[NativeDelivery:turn-failed-outbox-error] chatroom=${event.chatroomId} role=${event.role} turn=${completion.turnId} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
        );
        if (activeTask) return { kind: 'release-slot' };
        return { kind: 'hold-slot', reason: 'turn-failed-outbox-enqueue-failed' };
      }
      return { kind: 'release-slot' };
    }
    // A completed native turn leaves the harness idle. The task may still be
    // acknowledged (for example, if the agent did not read it), so retaining
    // the local marker would make every subsequent reconcile look like a
    // duplicate forever. In-progress/completed task snapshots are filtered by
    // the normal task-status gate on the next pass.
    this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
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

  // fallow-ignore-next-line unused-class-member
  dispose(): void {
    this.unsubscribeAgentTurnEnded();
    this.unsubscribeAgentStarted();
    this.unsubscribeAgentSessionLost();
    this.unsubscribeTaskService?.();
    this.unsubscribeTaskService = undefined;
    this.nativeTaskDeliveryQueue.stop();
  }

  // fallow-ignore-next-line unused-class-member
  get agentTaskState(): AgentTaskStateService {
    return this.deps.agentTaskState;
  }

  async handleTaskServiceNotification(notification: TaskServiceNotification): Promise<void> {
    if (notification.kind === 'bootstrap') {
      await this.requestReconcileForSnapshots(notification.snapshots, 'bootstrap');
      return;
    }
    if (notification.event.eventType === WorkspaceTaskInboxEventType.TaskDeleted) {
      await this.cancelTaskWork(
        notification.event.chatroomId,
        notification.event.role,
        notification.event.taskId
      );
    }
    await this.requestReconcile({
      chatroomId: notification.event.chatroomId,
      role: notification.event.role,
      source: 'inbox-signal',
    });
  }

  private async cancelTaskWork(chatroomId: string, role: string, taskId: string): Promise<void> {
    const activeTask = this.deps.agentTaskState.get({ chatroomId, role });
    if (activeTask?.taskId !== taskId) return;

    this.deps.agentTaskState.clear({ chatroomId, role });
    const slot = this.deps.agentMgr.getSlot(chatroomId, role);
    if (!slot || slot.state === 'idle' || slot.state === 'stopping') return;

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
  }): Promise<void> {
    const key = `${params.chatroomId}:${params.role.toLowerCase()}`;
    const existing = this.reconcileStates.get(key);
    if (existing) {
      existing.pendingSource = params.source;
      await existing.promise;
      return;
    }

    const state = {
      pendingSource: undefined as AgentWorkPass | undefined,
      promise: Promise.resolve(),
    };
    // fallow-ignore-next-line complexity
    state.promise = (async () => {
      try {
        do {
          const source = state.pendingSource ?? params.source;
          state.pendingSource = undefined;
          const snapshots = this.deps.taskSnapshotState.listForRole(params.chatroomId, params.role);
          if (snapshots.length === 0) {
            logNativeDeliveryDecision(source, params.role, params.chatroomId, 'idle', undefined, {
              reason: 'no_deliverable_task',
              attemptId: `${Date.now()}-${params.chatroomId}-${params.role}`,
            });
          }
          await this.reconcileRole(source, snapshots, params.onTaskDelivered);
        } while (state.pendingSource !== undefined);
      } finally {
        if (this.reconcileStates.get(key) === state) this.reconcileStates.delete(key);
      }
    })();
    this.reconcileStates.set(key, state);
    await state.promise;
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

  private async requestReconcileForSnapshots(
    snapshots: readonly AssignedTaskSnapshotView[],
    source: AgentWorkPass
  ): Promise<void> {
    const roles = new Set(
      snapshots.map(
        (snapshot) => `${snapshot.chatroomId}:${snapshot.agentConfig.role.toLowerCase()}`
      )
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
    pass: AgentWorkPass | LegacyAgentWorkPass,
    snapshots: readonly AssignedTaskSnapshotView[],
    onTaskDelivered?: AgentTaskDeliveredHandler
  ): Promise<void> {
    if (snapshots.length === 0) return;
    await processTasksUpdate(
      this.deps.runtime,
      this.deps.effectContext,
      this.deps.agentMgr,
      this.deps.runSerializedForAgent,
      this.deliveryTaskService,
      this.deps.sessionDeps,
      this.deps.machineId,
      pass,
      this.deps.lifecycleOutbox,
      ({ chatroomId, role, taskId }) =>
        this.deps.agentTaskState.get({ chatroomId, role })?.taskId === taskId,
      {
        snapshots,
        onTaskDelivered: (args) => {
          this.recordTaskDelivered(args);
          onTaskDelivered?.(args);
        },
      }
    );
  }

  recordTaskDelivered(args: { chatroomId: string; role: string; taskId: string }): void {
    this.deps.agentTaskState.start(args);
  }
}
