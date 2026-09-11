// fallow-ignore-file complexity

import { logNativeDeliveryDecision } from './native-delivery-log.js';
import type { NativeTaskDeliverySessionDeps } from './native-task-delivery-coordinator.js';
import { getRoleDeliveryState } from './role-delivery-state.js';
import {
  processTasksUpdate,
  type TaskDeliveryContext,
  type TaskDeliveryRuntime,
} from './task-delivery-processor.js';
import {
  buildAgentLifecycleRevisionKey,
  type AgentLifecycleFact,
} from '../../../../domain/entities/agent-lifecycle-fact.js';
import type { AssignedTaskSnapshotView } from '../../../../domain/entities/assigned-task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../../../entry/daemon-services.js';
import type { TaskSnapshotStateReader } from '../../../../infrastructure/inbox/task-snapshot-state.js';
import type {
  AgentStartedEvent,
  AgentSessionLostEvent,
  AgentTurnEndedEvent,
  AgentTurnDisposition,
  AgentTaskStateService,
  AgentProcessManagerService,
  TaskService,
} from '../../../service-interfaces.js';
import type { TaskServiceNotification } from '../../index.js';

export type NativeDeliveryPass =
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'inbox-signal'
  | 'agent-session-lost'
  | 'agent-started'
  | 'turn-ended'
  | 'restart-completed';
// Compatibility aliases remain accepted by the internal delivery adapter while
// callers migrate to requestReconcile and the canonical trigger names above.
export type LegacyNativeDeliveryPass = 'inbox-signal' | 'restart';

export type NativeTaskDeliveredHandler = (args: {
  chatroomId: string;
  role: string;
  taskId: string;
  harnessSessionId: string;
}) => void;

type TaskDeliveryService = Pick<
  TaskService,
  | 'deliverNativeTask'
  | 'isNativeHarness'
  | 'releaseTaskAfterTurnFailure'
  | 'snapshotRequestsNativeColdSession'
  | 'explainNativeDeliveryBlock'
  | 'loadAssignedTaskForAction'
> &
  Partial<Pick<TaskService, 'subscribe'>>;

export interface NativeDeliveryServiceDependencies {
  readonly runtime: TaskDeliveryRuntime;
  readonly effectContext: TaskDeliveryContext;
  readonly agentMgr: DaemonAgentProcessManagerServiceShape;
  readonly runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
  readonly sessionDeps: NativeTaskDeliverySessionDeps;
  readonly machineId: string;
  /** Read-only compatibility façade; the instance is owned by TaskService. */
  readonly taskSnapshotState: TaskSnapshotStateReader;
  readonly agentTaskState: AgentTaskStateService;
  readonly lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
  readonly taskService: TaskDeliveryService;
}

/**
 * Per-daemon native delivery application service.
 *
 * This is the composition boundary for task inbox updates. Callers provide a
 * constructed instance instead of resolving delivery dependencies through the
 * module-level session registry.
 */
export class NativeDeliveryService {
  private readonly unsubscribeAgentTurnEnded: () => void;
  private readonly unsubscribeAgentStarted: () => void;
  private readonly unsubscribeAgentSessionLost: () => void;
  private readonly reconcileStates = new Map<
    string,
    {
      pendingSource: NativeDeliveryPass | undefined;
      promise: Promise<void>;
    }
  >();
  private unsubscribeTaskService: (() => void) | undefined;

  constructor(private readonly deps: NativeDeliveryServiceDependencies) {
    this.unsubscribeAgentTurnEnded = deps.agentMgr.subscribeAgentTurnEnded((event) =>
      this.handleAgentTurnEnded(event)
    );
    this.unsubscribeAgentStarted = deps.agentMgr.subscribeAgentStarted((event) =>
      this.handleAgentStarted(event)
    );
    this.unsubscribeAgentSessionLost = deps.agentMgr.subscribeAgentSessionLost((event) =>
      this.handleAgentSessionLost(event)
    );
    this.unsubscribeTaskService = deps.taskService.subscribe?.((notification) =>
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
    await this.requestReconcile({
      chatroomId: notification.event.chatroomId,
      role: notification.event.role,
      source: 'inbox-signal',
    });
  }

  async requestReconcile(params: {
    chatroomId: string;
    role: string;
    source: NativeDeliveryPass;
    onTaskDelivered?: NativeTaskDeliveredHandler;
  }): Promise<void> {
    const key = `${params.chatroomId}:${params.role.toLowerCase()}`;
    const existing = this.reconcileStates.get(key);
    if (existing) {
      existing.pendingSource = params.source;
      await existing.promise;
      return;
    }

    const state = {
      pendingSource: undefined as NativeDeliveryPass | undefined,
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
    source: NativeDeliveryPass
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
    pass: NativeDeliveryPass | LegacyNativeDeliveryPass,
    snapshots: readonly AssignedTaskSnapshotView[],
    onTaskDelivered?: NativeTaskDeliveredHandler
  ): Promise<void> {
    if (snapshots.length === 0) return;
    await processTasksUpdate(
      this.deps.runtime,
      this.deps.effectContext,
      this.deps.agentMgr,
      this.deps.runSerializedForAgent,
      this.deps.taskService,
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
