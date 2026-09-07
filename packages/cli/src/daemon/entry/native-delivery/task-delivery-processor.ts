// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * - Inbox signal delivery processes snapshots hydrated by the machine inbox.
 * - Periodic reconciliation retries delivery decisions from the inbox-owned state.
 *
 * Fat task.content is fetched when reviving or injecting.
 * Dual-channel WorkingSnapshot hydrate still uses one-shot HTTP.
 */

import type { Runtime, type Context } from 'effect';

import { logNativeDeliveryFallback } from './native-delivery-log.js';
import {
  getNativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import type { AgentProcessManagerService } from '../../infrastructure/agent-process-manager/service/index.js';
import type {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  DaemonAgentProcessManagerServiceShape,
} from '../daemon-services.js';
import { filterSnapshotsExcludingRestartInFlight } from '../restart-orchestrator-in-flight.js';
import type { RecoveryCooldown } from '../task-delivery/task-delivery-logic.js';

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

type TaskDeliveryPass = 'inbox-signal' | 'periodic-reconcile' | 'bootstrap' | 'operational-status';

/* Recovery wake/revive helpers removed; retained below temporarily for the cleanup phase. */
/*
function runNativeReviveEffect(
  task: AssignedTaskWithContent,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent']
): void {
  const ctx = resolveTaskRunnerContextFromFull(task);
  if (!ctx) return;
  const { chatroomId, agentConfig, role, workingDir, wantResume } = ctx;

  console.log(
    `[TaskMonitor] native revive ${role}@${chatroomId} — backend PID stale or missing locally for pending task ${task.taskId}`
  );

  Runtime.runFork(runtime)(
    Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        runSerializedForAgent(
          { chatroomId, role },
          { timeoutMs: NATIVE_START_OPERATION_TIMEOUT_MS },
          (ops, context) =>
            ops.startAgent(
              {
                chatroomId,
                role,
                agentHarness: agentConfig.agentHarness as AgentHarness,
                model: agentConfig.model,
                workingDir,
                reason: AgentStartReasonEnum['platform.task_monitor_nudge'],
                wantResume,
                lifecycleRevision: task.agentConfig.configLifecycleRevision,
                taskId: task.taskId,
              },
              context.signal
            )
        )
      ).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() =>
            console.warn(
              `[TaskMonitor] native revive rejected for ${role}@${chatroomId}: ${getErrorMessage(error)}`
            )
          )
        )
      );
    }).pipe(
      Effect.provide(effectContext),
      Effect.catchAll((err) =>
        Effect.sync(() =>
          console.warn(
            `[TaskMonitor] native revive failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`
          )
        )
      )
    )
  );
}

function runNativeWakeEffect(
  task: AssignedTaskWithContent,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent']
): void {
  const ctx = resolveTaskRunnerContextFromFull(task);
  if (!ctx) return;
  const { chatroomId, agentConfig, role, workingDir, wantResume } = ctx;
  console.log(
    `[TaskMonitor] native wake ${role}@${chatroomId} — operational_state=stopped with pending task ${task.taskId}`
  );
  Runtime.runFork(runtime)(
    Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        runSerializedForAgent(
          { chatroomId, role },
          { timeoutMs: NATIVE_START_OPERATION_TIMEOUT_MS },
          (ops, context) =>
            ops.startAgent(
              {
                chatroomId,
                role,
                agentHarness: agentConfig.agentHarness as AgentHarness,
                model: agentConfig.model,
                workingDir,
                reason: AgentStartReasonEnum['platform.pending_task_wake'],
                wantResume,
                lifecycleRevision: task.agentConfig.configLifecycleRevision,
                taskId: task.taskId,
              },
              context.signal
            )
        )
      ).pipe(
        Effect.catchAll((error) =>
          Effect.sync(() =>
            console.warn(
              `[TaskMonitor] native wake rejected for ${role}@${chatroomId}: ${getErrorMessage(error)}`
            )
          )
        )
      );
    }).pipe(
      Effect.provide(effectContext),
      Effect.catchAll((err) =>
        Effect.sync(() =>
          console.warn(
            `[TaskMonitor] native wake failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`
          )
        )
      )
    )
  );
}

async function fetchTaskForAction(
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  snapshotRow: AssignedTaskSnapshotView
): Promise<AssignedTaskWithContent | null> {
  const result = await sessionDeps.backend.query(api.machines.getAssignedTaskForAction, {
    sessionId: sessionDeps.sessionId,
    machineId,
    taskId: snapshotRow.taskId,
    role: snapshotRow.agentConfig.role,
  });
  return result ? mapAssignedTaskView(result as Parameters<typeof mapAssignedTaskView>[0]) : null;
}

async function clearStuckStoppingSlotIfNeeded(
  agentMgr: DaemonAgentProcessManagerServiceShape,
  chatroomId: string,
  role: string,
  clearStopIntent: boolean
): Promise<void> {
  const cleared = await agentMgr.clearStuckStoppingSlot(chatroomId, role, {
    clearStopIntent,
  });
  if (cleared) {
    console.log(`[TaskMonitor] cleared stuck stopping slot for ${role}@${chatroomId}`);
  }
}

// Normalize expired stopping slots before ownership selection, so a cold
// delivery decision and recovery suppression observe the same lifecycle.
async function normalizeStuckStoppingSlots(
  tasks: AssignedTaskSnapshotView[],
  agentMgr: DaemonAgentProcessManagerServiceShape
): Promise<void> {
  const seen = new Set<string>();
  for (const row of tasks) {
    const key = `${row.chatroomId}:${row.agentConfig.role.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isRestartOrchestratorInFlight(row.chatroomId, row.agentConfig.role)) continue;
    await clearStuckStoppingSlotIfNeeded(
      agentMgr,
      row.chatroomId,
      row.agentConfig.role,
      row.agentConfig.desiredState === 'running'
    );
  }
}

async function reviveNativeTasks(
  tasks: AssignedTaskSnapshotView[],
  localHealth: {
    getSlot: (
      chatroomId: string,
      role: string
    ) => ReturnType<DaemonAgentProcessManagerServiceShape['getSlot']>;
    isPidAlive: (pid: number) => boolean;
  },
  now: number,
  cooldown: RecoveryCooldown,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'],
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<void> {
  for (const row of listNativeTasksNeedingRevive(tasks, localHealth, now, cooldown)) {
    if (isRestartOrchestratorInFlight(row.chatroomId, row.agentConfig.role)) continue;
    const full = await fetchTaskForAction(sessionDeps, machineId, row);
    if (!full) continue;
    runNativeReviveEffect(full, runtime, effectContext, runSerializedForAgent);
  }
}

async function wakeStoppedAgentsForPendingTasks(
  tasks: AssignedTaskSnapshotView[],
  now: number,
  cooldown: RecoveryCooldown,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'],
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<void> {
  for (const row of listNativePendingTasksNeedingWake(tasks, cooldown, now)) {
    if (isRestartOrchestratorInFlight(row.chatroomId, row.agentConfig.role)) continue;
    const full = await fetchTaskForAction(sessionDeps, machineId, row);
    if (!full) continue;
    runNativeWakeEffect(full, runtime, effectContext, runSerializedForAgent);
  }
}
*/

export async function processTasksUpdate(
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  cooldown: RecoveryCooldown,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'],
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  _pass: TaskDeliveryPass,
  options: ProcessTasksUpdateOptions
): Promise<void> {
  const tasks = [...options.snapshots];
  const filteredTasks = filterSnapshotsExcludingRestartInFlight(tasks);
  if (filteredTasks.length === 0) return;

  if (filteredTasks.length > 0) {
    const first = filteredTasks[0];
    logNativeDeliveryFallback(_pass, first.agentConfig.role, first.chatroomId, first.taskId);
  }
  getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks: filteredTasks,
    runtime,
    effectContext,
    agentMgr,
    runSerializedForAgent,
    sessionDeps,
    machineId,
    onTaskDelivered: options.onTaskDelivered,
  });
}
