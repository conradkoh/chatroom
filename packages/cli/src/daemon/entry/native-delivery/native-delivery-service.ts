import type { NativeTaskDeliverySessionDeps } from './native-task-delivery-coordinator.js';
import {
  processTasksUpdate,
  type TaskDeliveryContext,
  type TaskDeliveryRuntime,
} from './task-delivery-processor.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type { AgentTaskStateService } from '../../infrastructure/agent-process-manager/components/agent-task-state/index.js';
import type { AgentProcessManagerService } from '../../infrastructure/agent-process-manager/service/index.js';
import type { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';
import type { TaskInboxUpdate } from '../../infrastructure/inbox/task.js';
import type { DaemonAgentProcessManagerServiceShape } from '../daemon-services.js';

export type NativeDeliveryPass =
  'inbox-signal' | 'periodic-reconcile' | 'bootstrap' | 'operational-status';

export interface NativeDeliveryServiceDependencies {
  readonly runtime: TaskDeliveryRuntime;
  readonly effectContext: TaskDeliveryContext;
  readonly agentMgr: DaemonAgentProcessManagerServiceShape;
  readonly runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
  readonly sessionDeps: NativeTaskDeliverySessionDeps;
  readonly machineId: string;
  readonly taskSnapshotState: MachineTaskSnapshotState;
  readonly agentTaskState: AgentTaskStateService;
}

/**
 * Per-daemon native delivery application service.
 *
 * This is the composition boundary for task inbox updates. Callers provide a
 * constructed instance instead of resolving delivery dependencies through the
 * module-level session registry.
 */
export class NativeDeliveryService {
  constructor(private readonly deps: NativeDeliveryServiceDependencies) {}

  get taskSnapshotState(): MachineTaskSnapshotState {
    return this.deps.taskSnapshotState;
  }

  get agentTaskState(): AgentTaskStateService {
    return this.deps.agentTaskState;
  }

  async handleTaskInboxUpdate(update: TaskInboxUpdate): Promise<void> {
    for (const signal of update.signals) {
      if (signal.taskStatus === 'completed') {
        this.recordTaskHandedOff({
          chatroomId: signal.chatroomId,
          role: signal.targetRole,
          taskId: signal.taskId,
        });
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
