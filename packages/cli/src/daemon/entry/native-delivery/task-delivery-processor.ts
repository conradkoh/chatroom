// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * Lifecycle activation is owned by the agent process manager service. This
 * module only filters snapshots and delegates ready work to native delivery.
 */

import type { Runtime, Context } from 'effect';

import { logNativeDeliveryFallback } from './native-delivery-log.js';
import { snapshotRequestsNativeColdSession } from './native-cold-session-delivery.js';
import {
  getNativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  DaemonAgentProcessManagerServiceShape,
} from '../daemon-services.js';
import { filterSnapshotsExcludingRestartInFlight } from '../restart-orchestrator-in-flight.js';
import type { AgentProcessManagerService } from '../../services/agent-process-service/index.js';
import { isNativeHarness } from '../../services/task-service/index.js';
import {
  isOperationalCircuitOpen,
  isOperationalStopIntentActive,
  type AgentOperationalReadModel,
} from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import { isSlotIdle } from '../../domain/usecase/check-agent-slot.js';
import { isChatroomStopScopeActive } from '../../services/agent-process-service/index.js';
import { AgentStartReasonEnum } from '@workspace/backend/src/domain/entities/agent.js';
import type { AgentHarness } from '../daemon-types.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';

export type TaskDeliveryRuntime = Runtime.Runtime<
  DaemonSessionService | DaemonAgentProcessManagerService
>;
export type TaskDeliveryContext = Context.Context<
  DaemonSessionService | DaemonAgentProcessManagerService
>;
export type ProcessTasksUpdateOptions = {
  snapshots: readonly AssignedTaskSnapshotView[];
  onTaskDelivered?: (args: {
    chatroomId: string;
    role: string;
    taskId: string;
    harnessSessionId: string;
  }) => void;
};

type TaskDeliveryPass =
  | 'inbox-signal'
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'operational-status'
  | 'restart';

/**
 * Activate pending native work through the process-manager serialization
 * boundary. Delivery remains the owner of deciding whether activation is
 * needed; the process manager remains the owner of actually starting it.
 */
export async function startPendingNativeAgents(
  tasks: readonly AssignedTaskSnapshotView[],
  agentMgr: DaemonAgentProcessManagerServiceShape,
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'],
  operationalModel: AgentOperationalReadModel
): Promise<void> {
  const started = new Set<string>();
  await Promise.all(
    tasks.map(async (task) => {
      if (
        task.status !== 'pending' ||
        !isNativeHarness(task.agentConfig.agentHarness) ||
        snapshotRequestsNativeColdSession(task) ||
        !task.agentConfig.workingDir
      ) {
        return;
      }
      const key = `${task.chatroomId}:${task.agentConfig.role.toLowerCase()}`;
      if (started.has(key)) return;
      const slot = agentMgr.getSlot(task.chatroomId, task.agentConfig.role);
      if (slot && !isSlotIdle(slot.state)) return;
      const operational = operationalModel?.get(task.chatroomId, task.agentConfig.role);
      if (isChatroomStopScopeActive(task.chatroomId)) return;
      if (isOperationalCircuitOpen(operational) || isOperationalStopIntentActive(operational)) return;
      started.add(key);
      try {
        await runSerializedForAgent(
          { chatroomId: task.chatroomId, role: task.agentConfig.role },
          { timeoutMs: 120_000 },
          (ops, context) =>
            ops.startAgent(
              {
                chatroomId: task.chatroomId,
                role: task.agentConfig.role,
                agentHarness: task.agentConfig.agentHarness as AgentHarness,
                model: task.agentConfig.model,
                workingDir: task.agentConfig.workingDir as string,
                reason:
                  operational?.operationalState === 'running'
                    ? AgentStartReasonEnum['platform.task_monitor_nudge']
                    : AgentStartReasonEnum['platform.pending_task_wake'],
                wantResume: false,
                lifecycleRevision: task.agentConfig.configLifecycleRevision,
                taskId: task.taskId,
              },
              context.signal
            )
        );
      } catch (error) {
        console.warn(
          `[NativeDelivery] pending agent activation failed for ${task.agentConfig.role}@${task.chatroomId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    })
  );
}

export async function processTasksUpdate(
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'],
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  pass: TaskDeliveryPass,
  lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> },
  operationalModel: AgentOperationalReadModel,
  isTaskActive: (args: { chatroomId: string; role: string; taskId: string }) => boolean,
  options: ProcessTasksUpdateOptions
): Promise<void> {
  const filteredTasks = filterSnapshotsExcludingRestartInFlight([...options.snapshots]);
  if (filteredTasks.length === 0) return;

  await startPendingNativeAgents(filteredTasks, agentMgr, runSerializedForAgent, operationalModel);

  const first = filteredTasks[0];
  logNativeDeliveryFallback(pass, first.agentConfig.role, first.chatroomId, first.taskId);
  await getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks: filteredTasks,
    runtime,
    effectContext,
    agentMgr,
    runSerializedForAgent,
    sessionDeps,
    lifecycleOutbox,
    operationalModel,
    isTaskActive,
    machineId,
    onTaskDelivered: options.onTaskDelivered,
  });
}
