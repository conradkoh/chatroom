import type { NativeTaskDeliverySessionDeps } from './native-task-delivery-coordinator.js';
import {
  processTasksUpdate,
  type TaskDeliveryContext,
  type TaskDeliveryRuntime,
} from './task-delivery-processor.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { TaskSnapshotStateReader } from '../../infrastructure/inbox/task-snapshot-state.js';
import type { TaskInboxUpdate } from '../../infrastructure/inbox/task.js';
import type {
  AgentStartedEvent,
  AgentSessionLostEvent,
  AgentTurnEndedEvent,
  AgentTaskStateService,
  AgentProcessManagerService,
  TaskService,
} from '../../services/service-interfaces.js';
import type { TaskServiceNotification } from '../../services/task-service/index.js';
import type { DaemonAgentProcessManagerServiceShape } from '../daemon-services.js';
import { getRoleDeliveryState } from '../role-delivery-state.js';

export type NativeDeliveryPass =
  'inbox-signal' | 'periodic-reconcile' | 'bootstrap' | 'operational-status' | 'restart';

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
  | 'snapshotRequestsNativeColdSession'
  | 'explainNativeDeliveryBlock'
>;

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
  readonly agentOperationalReadModel: AgentOperationalReadModel;
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
  }

  async handleAgentStarted(event: AgentStartedEvent): Promise<void> {
    const tasks = this.deps.taskSnapshotState.listForRole(event.chatroomId, event.role);
    await this.processSnapshots('operational-status', tasks);
  }

  handleAgentSessionLost(event: AgentSessionLostEvent): void {
    getRoleDeliveryState().resetDeliveryState(event.chatroomId, event.role);
    this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
  }

  async handleAgentTurnEnded(event: AgentTurnEndedEvent): Promise<void> {
    // The manager invokes this handler while the agent's lifecycle operation
    // is still serialized. Schedule delivery for the next turn of the event
    // loop so it cannot attempt to inject while that operation still owns the
    // per-agent boundary.
    this.scheduleRoleDelivery(event.chatroomId, event.role);
  }

  private scheduleRoleDelivery(chatroomId: string, role: string): void {
    setTimeout(() => {
      const snapshots = this.deps.taskSnapshotState.listForRole(chatroomId, role);
      void this.processSnapshots('operational-status', snapshots).catch((error: unknown) => {
        console.warn(
          `[NativeDelivery] post-turn delivery failed for ${role}@${chatroomId}: ${error instanceof Error ? error.message : String(error)}`
        );
      });
    }, 0);
  }

  dispose(): void {
    this.unsubscribeAgentTurnEnded();
    this.unsubscribeAgentStarted();
    this.unsubscribeAgentSessionLost();
  }

  get agentTaskState(): AgentTaskStateService {
    return this.deps.agentTaskState;
  }

  async handleTaskInboxUpdate(update: TaskInboxUpdate): Promise<void> {
    await this.processSnapshots('inbox-signal', update.snapshots);
  }

  async handleTaskServiceNotification(notification: TaskServiceNotification): Promise<void> {
    if (notification.kind === 'bootstrap') {
      await this.processSnapshots('bootstrap', notification.snapshots);
      return;
    }
    await this.handleTaskInboxUpdate(notification.update);
  }

  async processSnapshots(
    pass: NativeDeliveryPass,
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
      this.deps.agentOperationalReadModel,
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
