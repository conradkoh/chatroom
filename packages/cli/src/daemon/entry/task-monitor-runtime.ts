/**
 * Task Monitor — indexed snapshot projection + WS signal/presence subscribe.
 *
 * - Snapshot store: hydrated once, then merged from incremental feed payloads
 * - Periodic reconcile reads the local store
 * - Signal feed: revisionKey cursor — revive/inject
 * - Presence feed: presenceUpdatedAt cursor — nudge timing (replaces 15s reconcile poll)
 *
 * Fat task.content is fetched only when nudging, reviving, or injecting.
 * Dual-channel WorkingSnapshot hydrate still uses one-shot HTTP.
 */

import {
  NATIVE_DELIVERY_RECONCILE_MS,
  TASK_MONITOR_SNAPSHOT_RECONCILE_MS,
} from '@workspace/backend/config/reliability.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import {
  shouldEmitSessionAugmentation,
  resolveSessionAugmentationForTask,
  sessionAugmentationNewSessionStarted,
  sessionAugmentationToWantResume,
} from '@workspace/backend/src/domain/handoff/parse-session-augmentation.js';
import { parseAssignedTaskMonitorRows } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';
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
import { createTaskMonitorSnapshot } from './task-monitor/task-monitor-snapshot.js';
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
import { logDaemonAuditEvent } from '../infrastructure/event-stream/daemon-event-emitter.js';

type TaskMonitorRuntime = Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
type TaskMonitorContext = Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;

type TaskMonitorPass = 'signal' | 'presence';

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
  runtime: TaskMonitorRuntime,
  effectContext: TaskMonitorContext,
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

// fallow-ignore-next-line complexity
function mergeInboundTaskEvent(
  event: AssignedTaskInboundEvent,
  snapshot: ReturnType<typeof createTaskMonitorSnapshot>
): AssignedTaskSnapshotView | undefined {
  switch (event.type) {
    case 'assigned-task.signal':
      return event.signal ? snapshot.mergeSignal(event.signal) : undefined;
    case 'assigned-task.presence':
      return event.presence ? snapshot.mergePresence(event.presence) : undefined;
  }
}

// fallow-ignore-next-line unused-export complexity
export function handleInboundAssignedTaskEvent(
  event: AssignedTaskInboundEvent,
  runMonitorPass: (tasks: AssignedTaskSnapshotView[], pass: TaskMonitorPass) => void,
  snapshot?: ReturnType<typeof createTaskMonitorSnapshot>
): void {
  const mergedRow = snapshot ? mergeInboundTaskEvent(event, snapshot) : undefined;
  if (snapshot && mergedRow) replaceAssignedTaskSnapshots(snapshot.listRows());

  const row =
    mergedRow ??
    listAssignedTaskSnapshots().find(
      (stored) => stored.taskId === event.taskId && stored.agentConfig.role === event.role
    );
  if (!row) return;
  const pass: TaskMonitorPass = event.type === 'assigned-task.signal' ? 'signal' : 'presence';
  runMonitorPass([row], pass);
}

// fallow-ignore-next-line complexity
export const startTaskMonitorEffect = (): Effect.Effect<
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

    const taskSnapshot = createTaskMonitorSnapshot();
    const cooldown = new NudgeCooldown();
    let stopped = false;
    let monitorPassInFlight = false;
    let snapshotHydrated = false;
    let snapshotRefreshInFlight = false;
    const pendingTaskEvents: AssignedTaskInboundEvent[] = [];

    const sessionDeps: NativeTaskDeliverySessionDeps = {
      sessionId: session.sessionId,
      convexUrl: session.convexUrl,
      machineId: session.machineId,
      logEvent: session.logEvent,
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

    // fallow-ignore-next-line complexity
    const drainPendingTaskEvents = (): void => {
      if (stopped || !snapshotHydrated || snapshotRefreshInFlight) return;
      for (const event of pendingTaskEvents.splice(0)) {
        handleInboundAssignedTaskEvent(event, runMonitorPass, taskSnapshot);
      }
    };

    registerAssignedTaskMonitorHandler(async (event) => {
      if (stopped) return;
      if (!snapshotHydrated || snapshotRefreshInFlight) {
        pendingTaskEvents.push(event);
        return;
      }
      handleInboundAssignedTaskEvent(event, runMonitorPass, taskSnapshot);
    });

    // fallow-ignore-next-line complexity
    const refreshSnapshot = async (): Promise<void> => {
      if (stopped || snapshotRefreshInFlight) return;
      snapshotRefreshInFlight = true;
      try {
        const result = await session.backend.query(api.machines.listMachineAssignedTaskSnapshots, {
          sessionId: session.sessionId,
          machineId: session.machineId,
        });
        if (stopped) return;
        const tasks = mapAssignedTaskSnapshotList(
          parseAssignedTaskMonitorRows((result as { tasks?: unknown })?.tasks ?? [])
        );
        taskSnapshot.replaceAll(tasks);
        replaceAssignedTaskSnapshots(tasks);
      } finally {
        snapshotRefreshInFlight = false;
        drainPendingTaskEvents();
      }
    };

    // Incremental feeds handle task and presence changes. A slow full refresh
    // bounds the lifetime of rows removed by terminal task transitions without
    // streaming the full snapshot on every projection invalidation.
    const snapshotReconcileTimer = setInterval(() => {
      void refreshSnapshot().catch((err: unknown) => {
        console.warn(
          `[${formatTimestamp()}] ⚠️  Assigned-task snapshot reconcile failed: ${getErrorMessage(err)}`
        );
      });
    }, TASK_MONITOR_SNAPSHOT_RECONCILE_MS);

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

    yield* Effect.tryPromise(() =>
      session.backend.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
        sessionId: session.sessionId,
        machineId: session.machineId,
      })
    ).pipe(Effect.catchAll(() => Effect.void));
    yield* Effect.tryPromise(refreshSnapshot).pipe(Effect.catchAll(() => Effect.void));
    snapshotHydrated = true;
    drainPendingTaskEvents();

    return {
      stop() {
        stopped = true;
        unregisterAssignedTaskMonitorHandler();
        clearInterval(snapshotReconcileTimer);
        clearAssignedTaskSnapshots();
        unregisterNativeDeliverySession();
        clearInterval(reconcileTimer);
        console.log(`[${formatTimestamp()}] 📋 Task-monitor stopped`);
      },
    };
  });
