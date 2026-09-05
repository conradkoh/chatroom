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

import { AgentStartReasonEnum } from '@workspace/backend/src/domain/entities/agent.js';
import {
  resolveSessionAugmentationForTask,
  sessionAugmentationToWantResume,
} from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import { Effect, Runtime, type Context } from 'effect';

import type {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  DaemonAgentProcessManagerServiceShape,
} from '../daemon-services.js';
import type { AgentHarness } from '../daemon-types.js';
import { logNativeDeliveryFallback } from './native-delivery-log.js';
import {
  getNativeTaskDeliveryCoordinator,
  type NativeTaskDeliverySessionDeps,
} from './native-task-delivery-coordinator.js';
import { api } from '../../../api.js';
import { isProcessAlive } from '../../../infrastructure/deps/process.js';
import { mapAssignedTaskView } from '../../../infrastructure/mappers/map-assigned-task.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../../domain/entities/assigned-task.js';
import {
  filterSnapshotsExcludingRestartInFlight,
  isRestartOrchestratorInFlight,
} from '../restart-orchestrator-in-flight.js';
import {
  listNativeTasksNeedingRevive,
  listNativePendingTasksNeedingWake,
} from '../task-delivery/task-delivery-logic.js';
import type { RecoveryCooldown } from '../task-delivery/task-delivery-logic.js';

export type TaskDeliveryRuntime = Runtime.Runtime<
  DaemonSessionService | DaemonAgentProcessManagerService
>;
export type TaskDeliveryContext = Context.Context<
  DaemonSessionService | DaemonAgentProcessManagerService
>;
export type ProcessTasksUpdateOptions = {
  snapshots: readonly AssignedTaskSnapshotView[];
};

type TaskDeliveryPass = 'inbox-signal' | 'periodic-reconcile' | 'bootstrap' | 'operational-status';

function resolveTaskWantResume(task: AssignedTaskWithContent): boolean {
  return sessionAugmentationToWantResume(
    resolveSessionAugmentationForTask(
      {
        content: task.taskContent ?? '',
        taskEnvelope: task.taskEnvelope,
        startInNewSession: task.startInNewSession,
      },
      task.agentConfig.role
    )
  );
}

function resolveTaskRunnerContextFromFull(task: AssignedTaskWithContent):
  | {
      chatroomId: string;
      agentConfig: AssignedTaskWithContent['agentConfig'];
      role: string;
      workingDir: string;
      wantResume: boolean;
    }
  | undefined {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const workingDir = agentConfig.workingDir;
  if (!workingDir) return undefined;
  return {
    chatroomId,
    agentConfig,
    role,
    workingDir,
    wantResume: resolveTaskWantResume(task),
  };
}

function runNativeReviveEffect(
  task: AssignedTaskWithContent,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  const ctx = resolveTaskRunnerContextFromFull(task);
  if (!ctx) return;
  const { chatroomId, agentConfig, role, workingDir, wantResume } = ctx;

  console.log(
    `[TaskMonitor] native revive ${role}@${chatroomId} — backend PID stale or missing locally for pending task ${task.taskId}`
  );

  Runtime.runFork(runtime)(
    Effect.gen(function* () {
      yield* agentMgr.ensureRunning({
        chatroomId,
        role,
        agentHarness: agentConfig.agentHarness as AgentHarness,
        model: agentConfig.model,
        workingDir,
        reason: AgentStartReasonEnum['platform.task_monitor_nudge'],
        wantResume,
        lifecycleRevision: task.agentConfig.configLifecycleRevision,
        taskId: task.taskId,
      });
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
  agentMgr: DaemonAgentProcessManagerServiceShape
): void {
  const ctx = resolveTaskRunnerContextFromFull(task);
  if (!ctx) return;
  const { chatroomId, agentConfig, role, workingDir, wantResume } = ctx;
  console.log(
    `[TaskMonitor] native wake ${role}@${chatroomId} — operational_state=stopped with pending task ${task.taskId}`
  );
  Runtime.runFork(runtime)(
    Effect.gen(function* () {
      yield* agentMgr.ensureRunning({
        chatroomId,
        role,
        agentHarness: agentConfig.agentHarness as AgentHarness,
        model: agentConfig.model,
        workingDir,
        reason: AgentStartReasonEnum['platform.pending_task_wake'],
        wantResume,
        lifecycleRevision: task.agentConfig.configLifecycleRevision,
        taskId: task.taskId,
      });
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
  role: string
): Promise<void> {
  const cleared = await agentMgr.clearStuckStoppingSlot(chatroomId, role);
  if (cleared) {
    console.log(`[TaskMonitor] cleared stuck stopping slot for ${role}@${chatroomId}`);
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
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<void> {
  for (const row of listNativeTasksNeedingRevive(tasks, localHealth, now, cooldown)) {
    if (isRestartOrchestratorInFlight(row.chatroomId, row.agentConfig.role)) continue;
    await clearStuckStoppingSlotIfNeeded(agentMgr, row.chatroomId, row.agentConfig.role);
    const full = await fetchTaskForAction(sessionDeps, machineId, row);
    if (!full) continue;
    runNativeReviveEffect(full, runtime, effectContext, agentMgr);
  }
}

async function wakeStoppedAgentsForPendingTasks(
  tasks: AssignedTaskSnapshotView[],
  now: number,
  cooldown: RecoveryCooldown,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<void> {
  for (const row of listNativePendingTasksNeedingWake(tasks, cooldown, now)) {
    if (isRestartOrchestratorInFlight(row.chatroomId, row.agentConfig.role)) continue;
    await clearStuckStoppingSlotIfNeeded(agentMgr, row.chatroomId, row.agentConfig.role);
    const full = await fetchTaskForAction(sessionDeps, machineId, row);
    if (!full) continue;
    runNativeWakeEffect(full, runtime, effectContext, agentMgr);
  }
}

export async function processTasksUpdate(
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  cooldown: RecoveryCooldown,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  _pass: TaskDeliveryPass,
  options: ProcessTasksUpdateOptions
): Promise<void> {
  const tasks = [...options.snapshots];
  const filteredTasks = filterSnapshotsExcludingRestartInFlight(tasks);
  if (filteredTasks.length === 0) return;

  const now = Date.now();
  const localHealth = {
    getSlot: (chatroomId: string, role: string) => agentMgr.getSlot(chatroomId, role),
    isPidAlive: (pid: number) => isProcessAlive((p) => process.kill(p, 0), pid),
  };

  await wakeStoppedAgentsForPendingTasks(
    filteredTasks,
    now,
    cooldown,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId
  );

  await reviveNativeTasks(
    filteredTasks,
    localHealth,
    now,
    cooldown,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId
  );
  if (filteredTasks.length > 0) {
    const first = filteredTasks[0];
    logNativeDeliveryFallback(_pass, first.agentConfig.role, first.chatroomId, first.taskId);
  }
  getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks: filteredTasks,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId,
  });
}
