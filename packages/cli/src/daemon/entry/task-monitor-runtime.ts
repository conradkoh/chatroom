/**
 * Task Monitor — indexed snapshot projection + WS signal/presence subscribe.
 *
 * - Snapshot store: subscribed via wsClient.onUpdate (no HTTP poll on timer)
 * - Periodic reconcile reads the local store
 * - Signal feed: revisionKey cursor — revive/inject
 * - Presence feed: presenceUpdatedAt cursor — nudge timing (replaces 15s reconcile poll)
 *
 * Fat task.content is fetched only when nudging, reviving, or injecting.
 * Dual-channel WorkingSnapshot hydrate still uses one-shot HTTP.
 */

import type { DatabaseSync } from 'node:sqlite';

import { NATIVE_DELIVERY_RECONCILE_MS } from '@workspace/backend/config/reliability.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import { roleSupportsSessionAugmentation } from '@workspace/backend/src/domain/entities/team-agent-settings.js';
import {
  resolveSessionAugmentationForRole,
  sessionAugmentationNewSessionStarted,
  sessionAugmentationToWantResume,
} from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import { parseAssignedTaskMonitorRows } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';
import type { ConvexClient } from 'convex/browser';
import { Effect, Runtime, type Context } from 'effect';

import {
  registerAssignedTaskMonitorHandler,
  unregisterAssignedTaskMonitorHandler,
} from './assigned-task-monitor-registry.js';
import {
  DaemonAgentProcessManagerService,
  DaemonSessionService,
  type DaemonAgentProcessManagerServiceShape,
} from './daemon-services.js';
import type { AgentHarness } from './daemon-types.js';
import { formatTimestamp } from './daemon-utils.js';
import { logNativeDeliveryFallback } from './native-delivery/native-delivery-log.js';
import {
  registerNativeDeliverySession,
  unregisterNativeDeliverySession,
} from './native-delivery/native-delivery-session-registry.js';
import { isAgentReadyForNativeDelivery } from './native-delivery/native-ready-invariant.js';
import {
  getNativeTaskDeliveryCoordinator,
  resetRoleDeliveryState,
  type NativeTaskDeliverySessionDeps,
} from './native-delivery/native-task-delivery-coordinator.js';
import { isNativeHarness } from './native-delivery/native-task-injector-logic.js';
import {
  filterSnapshotsExcludingRestartInFlight,
  isRestartOrchestratorInFlight,
} from './restart-orchestrator-in-flight.js';
import { getRoleDeliveryState } from './role-delivery-state.js';
import {
  listTasksReadyForNudge,
  listNativeTasksNeedingRevive,
  NudgeCooldown,
  shouldEscalateNativeNudgeToRestart,
} from './task-monitor/task-monitor-logic.js';
import { api } from '../../api.js';
import { isProcessAlive } from '../../infrastructure/deps/process.js';
import {
  mapAssignedTaskSnapshotList,
  mapAssignedTaskView,
} from '../../infrastructure/mappers/map-assigned-task.js';
import {
  clearAssignedTaskSnapshots,
  hasAssignedTaskSnapshot,
  listAssignedTaskSnapshots,
  replaceAssignedTaskSnapshots,
} from '../../infrastructure/stores/assigned-task-snapshot-store.js';
import { getErrorMessage } from '../../utils/convex-error.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../domain/entities/assigned-task.js';
import { isTeamAgentRole } from '../domain/entities/execution-kind.js';
import type { AssignedTaskInboundEvent } from '../domain/usecase/handle-assigned-task-inbound.js';
import {
  taskReadModelFromSnapshot,
  upsertTaskReadModel,
} from '../infrastructure/persistence/read-models/tasks.js';
import { listSnapshotViewsFromReadModels } from '../infrastructure/persistence/read-models/task-snapshot-adapter.js';

type TaskMonitorRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskMonitorContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

type TaskMonitorPass = 'signal' | 'presence';

let taskMonitorReadModelDb: DatabaseSync | undefined;

/** Set the SQLite handle used for P2 shadow-sync of read models (set by start-daemon when P2 enabled). */
export function setTaskMonitorReadModelDb(db: DatabaseSync | undefined): void {
  taskMonitorReadModelDb = db;
}

function resolveTaskWantResume(task: AssignedTaskWithContent): boolean {
  return sessionAugmentationToWantResume(
    resolveSessionAugmentationForRole(task.taskContent ?? '', task.agentConfig.role)
  );
}

function buildCliNudgeLogLine(task: AssignedTaskWithContent): string {
  const { chatroomId, agentConfig } = task;
  const { role } = agentConfig;
  const lastSeenAction = task.participant?.lastSeenAction ?? 'unknown';
  const augmentationMode = resolveSessionAugmentationForRole(task.taskContent ?? '', role);
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
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string
): void {
  const ctx = resolveTaskRunnerContextFromFull(task);
  if (!ctx) return;
  const { chatroomId, agentConfig, role, workingDir, wantResume } = ctx;
  const augmentationMode = resolveSessionAugmentationForRole(task.taskContent ?? '', role);

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
      if (roleSupportsSessionAugmentation(role)) {
        yield* Effect.tryPromise({
          try: () =>
            sessionDeps.backend.mutation(api.machines.emitSessionAugmented, {
              sessionId: sessionDeps.sessionId,
              machineId,
              chatroomId,
              role,
              taskId: task.taskId,
              mode: augmentationMode,
              newSessionStarted: sessionAugmentationNewSessionStarted(augmentationMode),
            }),
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
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
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
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
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

// fallow-ignore-next-line complexity
async function nudgeStuckTasks(
  tasks: AssignedTaskSnapshotView[],
  now: number,
  cooldown: NudgeCooldown,
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
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
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
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

async function processTasksUpdate(
  tasks: AssignedTaskSnapshotView[],
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
  cooldown: NudgeCooldown,
  agentMgr: DaemonAgentProcessManagerServiceShape,
  sessionDeps: NativeTaskDeliverySessionDeps,
  machineId: string,
  _pass: TaskMonitorPass
): Promise<void> {
  const filteredTasks = filterSnapshotsExcludingRestartInFlight(tasks);
  if (filteredTasks.length === 0) return;

  const now = Date.now();
  const localHealth = {
    getSlot: (chatroomId: string, role: string) => agentMgr.getSlot(chatroomId, role),
    isPidAlive: (pid: number) => isProcessAlive((p) => process.kill(p, 0), pid),
  };

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

function listDeliverablePendingFromStore(
  agentMgr: DaemonAgentProcessManagerServiceShape
): AssignedTaskSnapshotView[] {
  if (!hasAssignedTaskSnapshot()) return [];
  return listAssignedTaskSnapshots().filter((row) => {
    if (row.status !== 'pending') return false;
    const slot = agentMgr.getSlot(row.chatroomId, row.agentConfig.role);
    return isAgentReadyForNativeDelivery(row, slot);
  });
}

function runLocalStoreReconcilePass(params: {
  stopped: boolean;
  monitorPassInFlight: boolean;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  runtime: TaskMonitorRuntime;
  effectContext: TaskMonitorContext;
  sessionDeps: NativeTaskDeliverySessionDeps;
  machineId: string;
}): void {
  const { stopped, monitorPassInFlight, agentMgr, runtime, effectContext, sessionDeps, machineId } =
    params;
  if (stopped || monitorPassInFlight) return;
  const deliverable = filterSnapshotsExcludingRestartInFlight(
    listDeliverablePendingFromStore(agentMgr)
  );
  if (deliverable.length === 0) return;
  const first = deliverable[0];
  logNativeDeliveryFallback(
    'periodic-reconcile',
    first.agentConfig.role,
    first.chatroomId,
    first.taskId
  );
  getNativeTaskDeliveryCoordinator().reconcileAssignedTasks({
    tasks: deliverable,
    runtime,
    effectContext,
    agentMgr,
    sessionDeps,
    machineId,
  });
}

function subscribeAssignedTaskSnapshotStore(
  wsClient: ConvexClient,
  args: { sessionId: string; machineId: string },
  isStopped: () => boolean
): () => void {
  return wsClient.onUpdate(
    api.machines.listMachineAssignedTaskSnapshots,
    args as never,
    // fallow-ignore-next-line complexity
    (result) => {
      if (isStopped()) return;
      const tasks = mapAssignedTaskSnapshotList(
        parseAssignedTaskMonitorRows((result as { tasks?: unknown })?.tasks ?? [])
      );
      replaceAssignedTaskSnapshots(tasks);
      if (
        taskMonitorReadModelDb &&
        true &&
        !true
      ) {
        for (const task of tasks) {
          upsertTaskReadModel(taskMonitorReadModelDb, taskReadModelFromSnapshot(task));
        }
      }
    },
    (err: unknown) => {
      console.warn(
        `[${formatTimestamp()}] ⚠️  Assigned-task snapshot subscription error: ${getErrorMessage(err)}`
      );
    }
  );
}

// fallow-ignore-next-line complexity
async function refreshAssignedTaskReadModelsFromConvex(
  sessionDeps: NativeTaskDeliverySessionDeps
): Promise<AssignedTaskSnapshotView[]> {
  const result = (await sessionDeps.backend.query(api.machines.listMachineAssignedTaskSnapshots, {
    sessionId: sessionDeps.sessionId,
    machineId: sessionDeps.machineId,
  })) as { tasks?: unknown };
  const tasks = mapAssignedTaskSnapshotList(parseAssignedTaskMonitorRows(result.tasks ?? []));
  if (taskMonitorReadModelDb) {
    for (const task of tasks) {
      upsertTaskReadModel(taskMonitorReadModelDb, taskReadModelFromSnapshot(task));
    }
  }
  replaceAssignedTaskSnapshots(tasks);
  return tasks;
}

function seedAssignedTaskSnapshotsFromReadModels(machineId: string): void {
  if (taskMonitorReadModelDb) replaceAssignedTaskSnapshots(listSnapshotViewsFromReadModels(taskMonitorReadModelDb, machineId));
}

// fallow-ignore-next-line complexity unused-export
export function handleInboundAssignedTaskEvent(
  event: AssignedTaskInboundEvent,
  runMonitorPass: (tasks: AssignedTaskSnapshotView[], pass: TaskMonitorPass) => void
): void {
  const row = listAssignedTaskSnapshots().find(
    (snapshot) => snapshot.taskId === event.taskId && snapshot.agentConfig.role === event.role
  );
  if (!row) return;
  const pass: TaskMonitorPass = event.type === 'assigned-task.signal' ? 'signal' : 'presence';
  runMonitorPass([row], pass);
}

// fallow-ignore-next-line complexity
export const startTaskMonitorEffect = (
  wsClient: ConvexClient
): Effect.Effect<
  { stop: () => void },
  never,
  DaemonSessionService | DaemonAgentProcessManagerService
> =>
  // fallow-ignore-next-line complexity
  Effect.gen(function* () {
    const session = yield* DaemonSessionService;
    const agentMgr = yield* DaemonAgentProcessManagerService;
    const effectContext = yield* Effect.context<
      DaemonSessionService | DaemonAgentProcessManagerService
    >();
    const runtime = yield* Effect.runtime<
      DaemonSessionService | DaemonAgentProcessManagerService
    >();

    console.log(`[${formatTimestamp()}] 📋 Starting task-monitor (incremental subscribe)`);

    const cooldown = new NudgeCooldown();
    let stopped = false;
    let monitorPassInFlight = false;

    const sessionDeps: NativeTaskDeliverySessionDeps = {
      sessionId: session.sessionId,
      convexUrl: session.convexUrl,
      machineId: session.machineId,
      backend: {
        mutation: (fn: unknown, args: Record<string, unknown>) =>
          session.backend.mutation(fn, args),
        query: (fn: unknown, args: Record<string, unknown>) => session.backend.query(fn, args),
      },
    };

    registerNativeDeliverySession({
      runtime,
      effectContext,
      agentMgr,
      sessionDeps,
      machineId: session.machineId,
    });

    seedAssignedTaskSnapshotsFromReadModels(session.machineId);

    const runMonitorPass = (tasks: AssignedTaskSnapshotView[], pass: TaskMonitorPass): void => {
      if (stopped || monitorPassInFlight || tasks.length === 0) return;
      monitorPassInFlight = true;
      void processTasksUpdate(
        tasks,
        runtime,
        effectContext,
        cooldown,
        agentMgr,
        sessionDeps,
        session.machineId,
        pass
      ).finally(() => {
        monitorPassInFlight = false;
      });
    };

    registerAssignedTaskMonitorHandler(async (event) => {
      handleInboundAssignedTaskEvent(event, runMonitorPass);
    });

    const reconcileTimer = setInterval(() => {
      runLocalStoreReconcilePass({
        stopped,
        monitorPassInFlight,
        agentMgr,
        runtime,
        effectContext,
        sessionDeps,
        machineId: session.machineId,
      });
    }, NATIVE_DELIVERY_RECONCILE_MS);

    return {
      stop() {
        stopped = true;
        unregisterAssignedTaskMonitorHandler();
        unsubscribeSnapshotStore?.();
        clearAssignedTaskSnapshots();
        unregisterNativeDeliverySession();
        clearInterval(reconcileTimer);
        console.log(`[${formatTimestamp()}] 📋 Task-monitor stopped`);
      },
    };
  });
