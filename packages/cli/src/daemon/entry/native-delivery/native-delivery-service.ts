import type { NativeTaskDeliverySessionDeps } from './native-task-delivery-coordinator.js';
import {
  processTasksUpdate,
  type TaskDeliveryContext,
  type TaskDeliveryRuntime,
} from './task-delivery-processor.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type {
  AgentStartedEvent,
  AgentTurnEndedEvent,
} from '../../infrastructure/agent-process-manager/agent-process-manager.js';
import type { AgentTaskStateService } from '../../infrastructure/agent-process-manager/components/agent-task-state/index.js';
import type { AgentProcessManagerService } from '../../infrastructure/agent-process-manager/service/index.js';
import type { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';
import type { TaskInboxUpdate } from '../../infrastructure/inbox/task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../daemon-services.js';

export type NativeDeliveryPass =
  'inbox-signal' | 'periodic-reconcile' | 'bootstrap' | 'operational-status';

const TASK_STATE_UPDATE_TIMEOUT_MS = 30_000;

export interface NativeDeliveryServiceDependencies {
  readonly runtime: TaskDeliveryRuntime;
  readonly effectContext: TaskDeliveryContext;
  readonly agentMgr: DaemonAgentProcessManagerServiceShape;
  readonly runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
  readonly sessionDeps: NativeTaskDeliverySessionDeps;
  readonly machineId: string;
  readonly taskSnapshotState: MachineTaskSnapshotState;
  readonly agentTaskState: AgentTaskStateService;
  readonly lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
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

  constructor(private readonly deps: NativeDeliveryServiceDependencies) {
    this.unsubscribeAgentTurnEnded = deps.agentMgr.subscribeAgentTurnEnded((event) =>
      this.handleAgentTurnEnded(event)
    );
    this.unsubscribeAgentStarted = deps.agentMgr.subscribeAgentStarted((event) =>
      this.handleAgentStarted(event)
    );
  }

  async handleAgentStarted(event: AgentStartedEvent): Promise<void> {
    const tasks = this.deps.taskSnapshotState.listForRole(event.chatroomId, event.role);
    await this.processSnapshots('operational-status', tasks);
  }

  async handleAgentTurnEnded(event: AgentTurnEndedEvent): Promise<'reminder_requested' | void> {
    const activeTask = this.deps.agentTaskState.get({
      chatroomId: event.chatroomId,
      role: event.role,
    });
    if (!activeTask) {
      this.scheduleRoleDelivery(event.chatroomId, event.role);
      return;
    }

    const result = await this.deps.agentTaskState.handleAgentTurnEnded({
      chatroomId: event.chatroomId,
      role: event.role,
      version: {
        taskId: activeTask.taskId,
        generation: activeTask.generation,
      },
      eventId: event.eventId,
    });
    if (result.outcome === 'reminder_requested') return 'reminder_requested';

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
  }

  get taskSnapshotState(): MachineTaskSnapshotState {
    return this.deps.taskSnapshotState;
  }

  get agentTaskState(): AgentTaskStateService {
    return this.deps.agentTaskState;
  }

  async handleTaskInboxUpdate(update: TaskInboxUpdate): Promise<void> {
    for (const signal of update.signals) {
      if (signal.taskStatus === 'completed') {
        await this.deps.runSerializedForAgent(
          { chatroomId: signal.chatroomId, role: signal.targetRole },
          { timeoutMs: TASK_STATE_UPDATE_TIMEOUT_MS },
          async () => {
            this.recordTaskHandedOff({
              chatroomId: signal.chatroomId,
              role: signal.targetRole,
              taskId: signal.taskId,
            });
          }
        );
      }
    }

    this.deps.taskSnapshotState.applySignalPage(update.signals, update.snapshots);
    await this.processSnapshots('inbox-signal', update.snapshots);
  }

  async processSnapshots(
    pass: NativeDeliveryPass,
    snapshots: readonly AssignedTaskSnapshotView[]
  ): Promise<void> {
    if (snapshots.length === 0) return;
    await processTasksUpdate(
      this.deps.runtime,
      this.deps.effectContext,
      this.deps.agentMgr,
      this.deps.runSerializedForAgent,
      this.deps.sessionDeps,
      this.deps.machineId,
      pass,
      this.deps.lifecycleOutbox,
      {
        snapshots,
        onTaskDelivered: ({ chatroomId, role, taskId }) =>
          this.recordTaskDelivered({ chatroomId, role, taskId }),
      }
    );
  }

  recordTaskDelivered(args: { chatroomId: string; role: string; taskId: string }): void {
    this.deps.agentTaskState.start(args);
  }

  recordTaskHandedOff(args: { chatroomId: string; role: string; taskId: string }): void {
    const key = { chatroomId: args.chatroomId, role: args.role };
    const active = this.deps.agentTaskState.get(key);
    if (active?.taskId !== args.taskId) return;
    this.deps.agentTaskState.markHandedOff(key, {
      taskId: active.taskId,
      generation: active.generation,
    });
  }
}
