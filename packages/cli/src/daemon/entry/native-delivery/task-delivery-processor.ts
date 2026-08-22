// fallow-ignore-file complexity
// fallow-ignore-file code-duplication
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * - Inbox signal delivery processes snapshots hydrated by the machine inbox.
 * - Periodic reconciliation retries delivery decisions from the inbox-owned state.
 *
 * Fat task.content is fetched only when nudging, reviving, or injecting.
 * Dual-channel WorkingSnapshot hydrate still uses one-shot HTTP.
 */

import {
  shouldEmitSessionAugmentation,
  resolveSessionAugmentationForTask,
  sessionAugmentationNewSessionStarted,
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
import { isNativeHarness } from './native-task-injector-logic.js';
import { api } from '../../../api.js';
import { isProcessAlive } from '../../../infrastructure/deps/process.js';
import { mapAssignedTaskView } from '../../../infrastructure/mappers/map-assigned-task.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../../domain/entities/assigned-task.js';
import { logDaemonAuditEvent } from '../../infrastructure/event-stream/daemon-event-emitter.js';
import {
  filterSnapshotsExcludingRestartInFlight,
  isRestartOrchestratorInFlight,
} from '../restart-orchestrator-in-flight.js';
import {
  listTasksReadyForNudge,
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
      { content: task.taskContent ?? '', startInNewSession: task.startInNewSession },
      task.agentConfig.role
    )
  );
}

function buildCliNudgeLogLine(task: AssignedTaskWithContent): string {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const lastSeenAction = task.participant?.lastSeenAction ?? 'unknown';
  const augmentationMode = resolveSessionAugmentationForTask(
    { content: task.taskContent ?? '', startInNewSession: task.startInNewSession },
    role
  );
  const wantResume = resolveTaskWantResume(task);
  return `[TaskMonitor] nudging ${role}@${chatroomId} — pending task ${task.taskId}, lastSeenAction=${lastSeenAction}, session_augmentation=${augmentationMode}, wantResume=${wantResume}`;
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

function executeCliNudge(
  task: AssignedTaskWithContent,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): void {
  const ctx = resolveTaskRunnerContextFromFull(task);
  if (!ctx) return;
  const { chatroomId, agentConfig, role, workingDir, wantResume } = ctx;
  const augmentationMode = resolveSessionAugmentationForTask(
    { content: task.taskContent ?? '', startInNewSession: task.startInNewSession },
    role
  );

  Runtime.runFork(runtime)(
    Effect.gen(function* () {
      yield* agentMgr.stop({ chatroomId, role, reason: 'platform.task_monitor_nudge' });
      yield* agentMgr.ensureRunning({
        chatroomId,
        role,
        agentHarness: agentConfig.agentHarness as AgentHarness,
        model: agentConfig.model,
        workingDir,
        reason: 'platform.task_monitor_nudge',
        wantResume,
      });
      if (shouldEmitSessionAugmentation(role, augmentationMode)) {
        yield* Effect.tryPromise({
          try: async () => {
            await logDaemonAuditEvent(sessionDeps.logEvent ?? (async () => undefined), {
              type: 'agent.sessionAugmented',
              chatroomId,
              role,
              machineId,
              taskId: task.taskId,
              mode: augmentationMode,
              newSessionStarted: sessionAugmentationNewSessionStarted(augmentationMode),
            });
            await sessionDeps.backend.mutation(api.daemon.agentEvents.sessionAugmented, {
              sessionId: sessionDeps.sessionId,
              machineId,
              chatroomId,
              role,
              taskId: task.taskId,
              mode: augmentationMode,
              newSessionStarted: sessionAugmentationNewSessionStarted(augmentationMode),
            });
          },
          catch: (err) => err,
        }).pipe(Effect.catchAll(() => Effect.void));
      }
    }).pipe(
      Effect.provide(effectContext),
      Effect.catchAll((err) =>
        Effect.sync(() =>
          console.warn(
            `[TaskMonitor] nudge failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`
          )
        )
      )
    )
  );
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
        reason: 'platform.task_monitor_nudge',
        wantResume,
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
        reason: 'platform.pending_task_wake',
        wantResume,
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

function runCliNudgeEffect(
  task: AssignedTaskWithContent,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): void {
  console.log(buildCliNudgeLogLine(task));
  executeCliNudge(task, runtime, effectContext, agentMgr, sessionDeps, machineId);
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

async function nudgeStuckTasks(
  tasks: AssignedTaskSnapshotView[],
  now: number,
  cooldown: RecoveryCooldown,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<void> {
  const getSlot = (chatroomId: string, role: string) => agentMgr.getSlot(chatroomId, role);

  const cliTasks = tasks.filter((task) => !isNativeHarness(task.agentConfig.agentHarness));
  for (const row of listTasksReadyForNudge(cliTasks, now, cooldown, getSlot)) {
    await clearStuckStoppingSlotIfNeeded(agentMgr, row.chatroomId, row.agentConfig.role);
    const full = await fetchTaskForAction(sessionDeps, machineId, row);
    if (!full) continue;
    runCliNudgeEffect(full, runtime, effectContext, agentMgr, sessionDeps, machineId);
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
  await nudgeStuckTasks(
    filteredTasks,
    now,
    cooldown,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId
  );
}
