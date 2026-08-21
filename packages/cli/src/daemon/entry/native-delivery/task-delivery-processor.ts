// fallow-ignore-file complexity
/**
 * Task delivery processor for inbox updates and periodic reconciliation.
 *
 * - Snapshot store: subscribed via wsClient.onUpdate (no HTTP poll on timer)
 * - Periodic reconcile reads the local store
 * - Signal feed: revisionKey cursor — revive/inject
 * - Presence feed: presenceUpdatedAt cursor — nudge timing (replaces 15s reconcile poll)
 *
 * Fat task.content is fetched only when nudging, reviving, or injecting.
 * Dual-channel WorkingSnapshot hydrate still uses one-shot HTTP.
 */

import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
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
  resetRoleDeliveryState,
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
import { isTeamAgentRole } from '../../domain/entities/execution-kind.js';
import { logDaemonAuditEvent } from '../../infrastructure/event-stream/daemon-event-emitter.js';
import {
  filterSnapshotsExcludingRestartInFlight,
  isRestartOrchestratorInFlight,
} from '../restart-orchestrator-in-flight.js';
import { getRoleDeliveryState } from '../role-delivery-state.js';
import {
  listTasksReadyForNudge,
  listNativeTasksNeedingRevive,
  listNativePendingTasksNeedingWake,
  shouldEscalateNativeNudgeToRestart,
} from '../task-monitor/task-monitor-logic.js';
import type { NudgeCooldown } from '../task-monitor/task-monitor-logic.js';

export type TaskDeliveryRuntime = Runtime.Runtime<
  DaemonSessionService | DaemonAgentProcessManagerService
>;
export type TaskDeliveryContext = Context.Context<
  DaemonSessionService | DaemonAgentProcessManagerService
>;

type TaskDeliveryPass = 'signal' | 'presence';

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
    `[TaskMonitor] native wake ${role}@${chatroomId} — desiredState=stopped with pending task ${task.taskId}`
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
  cooldown: NudgeCooldown,
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): Promise<void> {
  const getSlot = (chatroomId: string, role: string) => agentMgr.getSlot(chatroomId, role);

  for (const row of listTasksReadyForNudge(tasks, now, cooldown, getSlot)) {
    await clearStuckStoppingSlotIfNeeded(agentMgr, row.chatroomId, row.agentConfig.role);

    if (isNativeHarness(row.agentConfig.agentHarness)) {
      const { chatroomId, agentConfig } = row;
      const { role } = agentConfig;
      if (!isTeamAgentRole(role)) continue;
      const deliveryState = getRoleDeliveryState();
      const failures = deliveryState.recordNativeNudgeFailure(chatroomId, role);

      if (shouldEscalateNativeNudgeToRestart(chatroomId, role, failures)) {
        const full = await fetchTaskForAction(sessionDeps, machineId, row);
        if (!full) continue;
        console.log(
          `[TaskMonitor] native nudge escalate restart ${role}@${chatroomId} — pending task ${row.taskId}`
        );
        runCliNudgeEffect(full, runtime, effectContext, agentMgr, sessionDeps, machineId);
        deliveryState.clearNativeNudgeFailures(chatroomId, role);
        continue;
      }

      resetRoleDeliveryState(chatroomId, role);
      await sessionDeps.backend.mutation(api.participants.join, {
        sessionId: sessionDeps.sessionId,
        chatroomId,
        role,
        action: NATIVE_WAITING_ACTION,
      });
      console.log(
        `[TaskMonitor] native light nudge ${role}@${chatroomId} — redeliver pending task ${row.taskId}`
      );
      logNativeDeliveryFallback('native-light-nudge', role, chatroomId, row.taskId);
      getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
        tasks: [row],
        runtime,
        effectContext,
        agentMgr,
        sessionDeps,
        machineId,
      });
      continue;
    }

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
  cooldown: NudgeCooldown,
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
  cooldown: NudgeCooldown,
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
  tasks: AssignedTaskSnapshotView[],
  runtime: TaskDeliveryRuntime,
  effectContext: TaskDeliveryContext,
  cooldown: NudgeCooldown,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  _pass: TaskDeliveryPass
): Promise<void> {
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
    logNativeDeliveryFallback(
      'signal-presence',
      first.agentConfig.role,
      first.chatroomId,
      first.taskId
    );
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
