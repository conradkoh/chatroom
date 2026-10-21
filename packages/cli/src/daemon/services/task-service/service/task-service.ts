// fallow-ignore-file complexity

import type { WorkspaceTaskInboxEventStatus } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { WorkspaceTaskInboxEventType } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import type { NativeDeliverySessionHandles } from './native-task-injector.js';
import type { TaskDeliveryOperations } from './ports/task-delivery-operations.js';
import {
  buildTaskServiceDebugState,
  type TaskServiceDebugState,
} from './task-service-debug-state.js';
import { createPendingTaskReconciliationWatcher } from './watchers/pending-task-reconciliation-watcher.js';
import { createTaskInboxAcknowledgementRetryWatcher } from './watchers/task-inbox-acknowledgement-retry-watcher.js';
import { createTaskInboxDeliveryRetryWatcher } from './watchers/task-inbox-delivery-retry-watcher.js';
import { api } from '../../../../api.js';
import type { TaskAssigneeType, AssignedTask } from '../../../domain/entities/assigned-task.js';
import {
  TaskInboxState,
  type TaskInboxStateReader,
  type TaskStateApplicationResult,
} from '../../../infrastructure/inbox/task-inbox-state.js';
import type { AgentConfigRegistry } from '../../chatroom-workspace-configuration-service/index.js';
import {
  decideUncoveredTurnEnd as decideLadderStep,
  withNudgeSent,
  withSessionRestart,
  type UncoveredTurnDecision,
  type UncoveredTurnLadderEntry,
} from '../domain/usecase/uncovered-turn-ladder.js';
import {
  mapPendingTaskInboxRows,
  createConvexNativeTaskDeliveryGateway,
} from '../infrastructure/adapters/convex-native-task-delivery-gateway.js';
import {
  type TaskHandoffRepository,
  type TaskHandoffRecord,
} from '../infrastructure/repository/task-handoff-repository.js';

/**
 * Slim task header carried on every inbox event. Produced by the gateway's
 * `pendingTaskInboxTaskSchema`; task content is loaded via `loadAssignedTaskForAction`.
 */
export interface WorkspaceTaskInboxEventTask {
  readonly taskId: string;
  readonly chatroomId: string;
  readonly status: string;
  readonly assignedTo?: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly startInNewSession?: boolean | undefined;
}

interface WorkspaceTaskInboxEventFields {
  readonly eventId: string;
  readonly machineId: string;
  readonly chatroomId: string;
  readonly taskId: string;
  readonly role: string;
  readonly assignee?:
    | { readonly type: TaskAssigneeType.Permanent }
    | {
        readonly type: TaskAssigneeType.Ephemeral;
        readonly ephemeral: {
          readonly agentHarness: string;
          readonly model: string;
          readonly workingDir: string;
        };
      }
    | undefined;
  readonly status: WorkspaceTaskInboxEventStatus;
  readonly createdAt: number;
  readonly task: WorkspaceTaskInboxEventTask;
}

export type WorkspaceTaskInboxEvent =
  | (WorkspaceTaskInboxEventFields & {
      readonly eventType: WorkspaceTaskInboxEventType.TaskAssigned;
    })
  | (WorkspaceTaskInboxEventFields & {
      readonly eventType: WorkspaceTaskInboxEventType.TaskUpdated;
    })
  | (WorkspaceTaskInboxEventFields & {
      readonly eventType: WorkspaceTaskInboxEventType.TaskDeleted;
    });

/**
 * Automatic re-arm delays after a task is parked as `redelivery_exhausted`.
 * The budget is bounded: after the last cycle the task stays parked until a
 * user restart. In-memory, like the rest of the redelivery tracking, so a
 * daemon restart clears both the timer and the cycle count.
 */
// Exported for the re-arm tests and as the documented re-arm contract.
// fallow-ignore-next-line unused-export
export const REARM_DELAYS_MS = [15 * 60_000, 30 * 60_000, 60 * 60_000] as const;
// fallow-ignore-next-line unused-export
export const MAX_REARM_CYCLES = REARM_DELAYS_MS.length;

export type TaskServiceNotification =
  | {
      readonly kind: 'bootstrap';
      readonly tasks: readonly AssignedTask[];
    }
  | {
      readonly kind: 'inbox-event';
      readonly event: WorkspaceTaskInboxEvent;
    }
  | {
      /** Safety-net wakeup for a task whose task-record status is still pending. */
      readonly kind: 'periodic-reconcile';
      readonly task: AssignedTask;
    };

export type TaskServiceDeliveryConfirmation = {
  readonly deliveredTaskIds?: readonly string[];
  readonly handledEventIds?: readonly string[];
};

export type TaskServiceListener = (
  notification: TaskServiceNotification
) => Promise<TaskServiceDeliveryConfirmation | void> | TaskServiceDeliveryConfirmation | void;

export interface TaskService extends TaskDeliveryOperations {
  /** Loads the initial task inbox state. */
  startTaskInbox(wsClient?: ConvexClient): Promise<void>;
  subscribe(listener: TaskServiceListener): () => void;
  stopTaskInbox(): void;
  listTasksForRole(chatroomId: string, role: string): readonly AssignedTask[];
  listAllTasks(): readonly AssignedTask[];
  /** Current backend task roles assigned to this machine within one chatroom. */
  listMachineTaskRolesForChatroom(chatroomId: string): Promise<readonly string[]>;
  /**
   * Daemon-local diagnostic snapshot for one chatroom: the in-memory read model
   * that delivery reads. Server-side models are queried separately by
   * `chatroom debug` via `api.daemon.chatroom.debug`. Never used by the delivery
   * path.
   */
  debugState(chatroomId: string): TaskServiceDebugState;
  readonly taskInboxState: TaskInboxStateReader;
  /**
   * Releases a single in-flight task back to backend `pending` after a native
   * turn failure, then patches the local state from the authoritative
   * backend response. The cache update happens only after backend success.
   */
  recordHandoffOutcome(args: {
    chatroomId: string;
    role: string;
    targetRole: string;
    nextTask?: AssignedTask | undefined;
    taskIds?: readonly string[] | undefined;
  }): Promise<void>;
  getLatestHandoff(chatroomId: string, role: string): Promise<TaskHandoffRecord | null>;
  /** Releases authoritative machine-owned in-flight tasks after agent loss. */
  recoverInFlightTasks(args: {
    chatroomId?: string;
    role?: string;
    mode: 'automatic' | 'explicit';
  }): Promise<{ released: number; skipped: number }>;
  /**
   * Notifies the task service that a delivered task's agent turn is producing
   * output (agent process service reports first turn progress). The task
   * service decides what that means: apply the read intent (pending/
   * acknowledged → in_progress, idempotent) and mark the open delivery
   * receipt started, so the backend never infers state from raw signals.
   */
  handleAgentTurnProgress(args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<void>;
}

export interface TaskServiceCompositionDependencies extends NativeDeliverySessionHandles {
  convexUrl: string;
  /** Daemon-local source of the latest agent harness/model/workingDir config. */
  configurationService: AgentConfigRegistry;
  /** Durable latest-handoff repository owned by this task service. */
  handoffRepository: TaskHandoffRepository;
}

export function createTaskService(deps: TaskServiceCompositionDependencies): TaskService {
  const gateway = createConvexNativeTaskDeliveryGateway(deps.backend);
  const handoffRepository = deps.handoffRepository;

  const taskInboxState = new TaskInboxState();
  const listeners = new Set<TaskServiceListener>();
  let stopInboxWatch: (() => void) | undefined;
  let stopTaskStatusWatch: (() => void) | undefined;
  let inboxStopped = false;
  // These in-memory sets prevent duplicate work during this daemon run. A restart
  // intentionally replays any event that was not durably marked as processed.
  const pendingEvents = new Map<string, WorkspaceTaskInboxEvent>();
  const scheduledEventIds = new Set<string>();
  const deliveredEventIds = new Set<string>();
  const taskChains = new Map<string, Promise<void>>();
  let bootstrapRecoveryPending = true;
  let bootstrapRecoveryAttempts = 0;
  let bootstrapRecoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let bootstrapRecoveryPromise: Promise<void> | undefined;

  // Turn-end tracking, per (chatroom, role, taskId). In-memory on purpose: a daemon
  // restart re-bounds the cycle. Two independent budgets:
  //  - turnFailureCounts: provider failures (failed / timed_out / aborted turns).
  //    Park after TURN_FAILURE_RETRY_CAP consecutive failures. The caller spaces
  //    each release with exponential backoff so a provider outage does not burn
  //    the budget in seconds.
  //  - uncoveredLadder: completed turns that end without a covering handoff.
  //    Nudge once per session, then restart the session once, then park.
  // Parking is the same for both: the key enters redeliveryExhaustedKeys and the
  // backend records 'redelivery_exhausted' once.
  // Reset on fresh task activity (task_assigned / completed / deleted) and on
  // user.start. Daemon-authored transitions (release, claim) do NOT reset anything.
  const TURN_FAILURE_RETRY_CAP = 8;
  const turnFailureCounts = new Map<string, number>();
  const uncoveredLadder = new Map<string, UncoveredTurnLadderEntry>();
  const redeliveryExhaustedKeys = new Set<string>();
  // Automatic re-arm after exhaustion: cycles already used and the pending timer
  // per key. Bounded by MAX_REARM_CYCLES and only reset by a user restart or a
  // task lifecycle end, never by a successful re-arm.
  const rearmCycleCounts = new Map<string, number>();
  const rearmTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Slice 1 backoff releases still waiting in the agent work manager. Automatic
  // recovery must not release these early; manual recovery still may.
  const pendingTurnFailureReleases = new Set<string>();
  const redeliveryKey = (chatroomId: string, role: string, taskId: string): string =>
    `${chatroomId}:${role.toLowerCase()}:${taskId}`;

  /** Stops the pending re-arm timer for one key, if any. */
  const clearRearmTimer = (key: string): void => {
    const timer = rearmTimers.get(key);
    if (timer === undefined) return;
    clearTimeout(timer);
    rearmTimers.delete(key);
  };

  /** Cancels the timer and forgets the cycles used. Only user restart / lifecycle end resets the budget. */
  const resetRearmBudget = (key: string): void => {
    clearRearmTimer(key);
    rearmCycleCounts.delete(key);
  };

  /**
   * Arms the next bounded re-arm for a parked task. A successful cycle does not
   * reset the cycle count: the third park after the third cycle stays parked.
   */
  const scheduleRedeliveryRearm = (args: {
    chatroomId: string;
    role: string;
    taskId: string;
    key: string;
  }): void => {
    if (inboxStopped) return;
    const { key } = args;
    const cycles = rearmCycleCounts.get(key) ?? 0;
    if (cycles >= MAX_REARM_CYCLES) {
      console.log(
        `[NativeDelivery:redelivery-rearm-exhausted] chatroom=${args.chatroomId} role=${args.role} task=${args.taskId} cycles=${MAX_REARM_CYCLES}`
      );
      return;
    }
    clearRearmTimer(key);
    const delay = REARM_DELAYS_MS[cycles];
    const timer = setTimeout(() => {
      rearmTimers.delete(key);
      void runRedeliveryRearm({ ...args, delay, cycle: cycles + 1 });
    }, delay);
    rearmTimers.set(key, timer);
  };

  /**
   * Runs one re-arm cycle: re-check the task is still the in-flight work, then
   * give it a fresh failure budget and release it for redelivery. Never restarts
   * the agent process.
   */
  const runRedeliveryRearm = async (args: {
    chatroomId: string;
    role: string;
    taskId: string;
    key: string;
    delay: number;
    cycle: number;
  }): Promise<void> => {
    const { chatroomId, role, taskId, key } = args;
    const current = taskInboxState.getForRole(chatroomId, role, taskId);
    if (!current || current.status !== 'in_progress' || !redeliveryExhaustedKeys.has(key)) {
      console.log(
        `[NativeDelivery:redelivery-rearm-skipped] reason=task_not_current chatroom=${chatroomId} role=${role} task=${taskId} status=${current?.status ?? 'missing'}`
      );
      return;
    }

    rearmCycleCounts.set(key, args.cycle);
    redeliveryExhaustedKeys.delete(key);
    turnFailureCounts.delete(key);

    try {
      await gateway.clearDeliveryFailure({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        taskId,
      });
    } catch (error) {
      console.warn(
        `[TaskService] redelivery-rearm clear failure failed chatroom=${chatroomId} role=${role} task=${taskId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    let released = false;
    try {
      const result = await releaseTask({ chatroomId, role, taskId });
      released = result.released;
      if (!released) {
        console.warn(
          `[TaskService] redelivery-rearm release skipped chatroom=${chatroomId} role=${role} task=${taskId} cycle=${args.cycle}`
        );
      }
    } catch (error) {
      console.error(
        `[TaskService] redelivery-rearm release failed chatroom=${chatroomId} role=${role} task=${taskId} cycle=${args.cycle}: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (!released) {
      // The task is still parked. Restore the backend record (it was cleared
      // optimistically) and try the next cycle rather than stranding it active.
      redeliveryExhaustedKeys.add(key);
      await recordExhaustedOnBackend({ chatroomId, role, taskId });
      scheduleRedeliveryRearm(args);
      return;
    }

    console.log(
      `[NativeDelivery:redelivery-rearm] cycle=${args.cycle}/${MAX_REARM_CYCLES} chatroom=${chatroomId} role=${role} task=${taskId} delayMs=${args.delay}`
    );
  };

  /** Writes (or re-writes) the backend exhaustion record. Best effort; the in-memory key is authoritative. */
  const recordExhaustedOnBackend = async (args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<void> => {
    try {
      await gateway.recordDeliveryFailure({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        taskId: args.taskId,
        reason: 'redelivery_exhausted',
      });
    } catch (error) {
      console.warn(
        `[TaskService] redelivery-exhausted failure record failed chatroom=${args.chatroomId} role=${args.role} task=${args.taskId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  };

  const parkTask = async (
    args: { chatroomId: string; role: string; taskId: string },
    reason: 'provider_failure' | 'uncovered_turn',
    attempts?: number
  ): Promise<void> => {
    const key = redeliveryKey(args.chatroomId, args.role, args.taskId);
    redeliveryExhaustedKeys.add(key);
    await recordExhaustedOnBackend(args);
    const attemptsSuffix = attempts === undefined ? '' : ` attempts=${attempts}`;
    console.log(
      `[NativeDelivery:redelivery-exhausted] chatroom=${args.chatroomId} role=${args.role} task=${args.taskId}${attemptsSuffix} — release/redelivery stopped; agent restart (user.start) resets`
    );
    // Only provider failures are safe to redeliver automatically. A task parked
    // by the uncovered-turn ladder may repeat side effects if replayed, so it
    // stays parked until a user restart.
    if (reason === 'provider_failure') {
      scheduleRedeliveryRearm({ ...args, key });
    }
  };

  /**
   * A provider failure. Returns the 1-based attempt number and whether the cap
   * is exceeded; the caller schedules the release with exponential backoff.
   * At the cap the task is parked instead of released.
   */
  const recordTurnFailure = async (args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<{ attempts: number; exceeded: boolean }> => {
    const key = redeliveryKey(args.chatroomId, args.role, args.taskId);
    const recordedAttempts = turnFailureCounts.get(key) ?? 0;
    if (redeliveryExhaustedKeys.has(key)) {
      return { attempts: recordedAttempts, exceeded: true };
    }
    const attempts = recordedAttempts + 1;
    turnFailureCounts.set(key, attempts);
    if (attempts < TURN_FAILURE_RETRY_CAP) return { attempts, exceeded: false };
    await parkTask(args, 'provider_failure', attempts);
    return { attempts, exceeded: true };
  };

  /**
   * A completed turn with no covering handoff. Returns the next ladder step.
   * Does not commit a nudge: confirmNudgeSent does that after the nudge is delivered.
   * Restart and park are committed here, before any side effect.
   * A covered or completed turn is not a failure, so it also clears the failure counter.
   */
  const decideUncoveredTurnEnd = async (args: {
    chatroomId: string;
    role: string;
    taskId: string;
    sessionKey: string;
    nudgeUnavailable?: boolean;
  }): Promise<UncoveredTurnDecision> => {
    const key = redeliveryKey(args.chatroomId, args.role, args.taskId);
    if (redeliveryExhaustedKeys.has(key)) return { action: 'park' };
    turnFailureCounts.delete(key);
    const entry = uncoveredLadder.get(key);
    const decision = decideLadderStep(entry, args.sessionKey, {
      nudgeUnavailable: args.nudgeUnavailable ?? false,
    });
    if (decision.action === 'restart-session') {
      uncoveredLadder.set(key, withSessionRestart(entry));
    } else if (decision.action === 'park') {
      await parkTask(args, 'uncovered_turn');
    }
    return decision;
  };

  const confirmNudgeSent = (args: {
    chatroomId: string;
    role: string;
    taskId: string;
    sessionKey: string;
  }): void => {
    const key = redeliveryKey(args.chatroomId, args.role, args.taskId);
    uncoveredLadder.set(key, withNudgeSent(uncoveredLadder.get(key), args.sessionKey));
  };

  /** Covered (handoff-backed) end: clear the ladder entry and the failure counter. Parked marker is kept. */
  const resetTurnTracking = (args: { chatroomId: string; role: string; taskId: string }): void => {
    const key = redeliveryKey(args.chatroomId, args.role, args.taskId);
    turnFailureCounts.delete(key);
    uncoveredLadder.delete(key);
  };

  const isRedeliveryExhausted = (args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): boolean =>
    redeliveryExhaustedKeys.has(redeliveryKey(args.chatroomId, args.role, args.taskId));
  const clearRedeliveryTrackingForTask = (
    chatroomId: string,
    role: string,
    taskId: string
  ): void => {
    const key = redeliveryKey(chatroomId, role, taskId);
    turnFailureCounts.delete(key);
    uncoveredLadder.delete(key);
    redeliveryExhaustedKeys.delete(key);
    resetRearmBudget(key);
  };
  const forgetStaleTask = ({
    chatroomId,
    role,
    taskId,
  }: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): void => {
    taskInboxState.remove(chatroomId, role, taskId, Date.now());
    pendingTaskReconciliationWatcher.clear(chatroomId, role, taskId);
    clearRedeliveryTrackingForTask(chatroomId, role, taskId);
  };

  /** Releases a single task back to `pending` via the backend, then patches
   *  the local read model from the authoritative result. */
  const releaseTask = async (args: { chatroomId: string; role: string; taskId: string }) => {
    const result = await gateway.releaseTaskAfterTurnFailure({
      sessionId: deps.sessionId,
      chatroomId: args.chatroomId,
      role: args.role,
      taskId: args.taskId,
    });
    taskInboxState.markStatus(
      args.chatroomId,
      args.role,
      args.taskId,
      result.status,
      result.updatedAt
    );
    const currentTask = taskInboxState.getForRole(args.chatroomId, args.role, args.taskId);
    if (currentTask?.status === 'pending') {
      pendingTaskReconciliationWatcher.watch(currentTask);
    } else {
      pendingTaskReconciliationWatcher.clear(args.chatroomId, args.role, args.taskId);
    }
    return result;
  };

  /** Clears exhausted/redelivery tracking for a whole role (user-initiated agent restart). */
  const clearRoleRedeliveryTracking = (chatroomId: string, role: string): void => {
    const prefix = `${chatroomId}:${role.toLowerCase()}:`;
    for (const key of [...turnFailureCounts.keys()]) {
      if (key.startsWith(prefix)) turnFailureCounts.delete(key);
    }
    for (const key of [...uncoveredLadder.keys()]) {
      if (key.startsWith(prefix)) uncoveredLadder.delete(key);
    }
    for (const key of [...redeliveryExhaustedKeys]) {
      if (key.startsWith(prefix)) redeliveryExhaustedKeys.delete(key);
    }
    for (const key of [...rearmTimers.keys()]) {
      if (key.startsWith(prefix)) resetRearmBudget(key);
    }
    for (const key of [...rearmCycleCounts.keys()]) {
      if (key.startsWith(prefix)) rearmCycleCounts.delete(key);
    }
  };

  const scheduleBootstrapRecovery = (): void => {
    if (inboxStopped || bootstrapRecoveryTimer || !bootstrapRecoveryPending) return;
    const delay = Math.min(30_000, 1_000 * 2 ** bootstrapRecoveryAttempts++);
    bootstrapRecoveryTimer = setTimeout(() => {
      bootstrapRecoveryTimer = undefined;
      if (!inboxStopped) void runBootstrapRecovery();
    }, delay);
  };

  // Keep startup on the shared automatic selector so handoff coverage and the
  // V2 exhausted-task cap apply to boot recovery as well as agent-loss recovery.
  const runBootstrapRecovery = (): Promise<void> => {
    if (inboxStopped || !bootstrapRecoveryPending) return Promise.resolve();
    if (bootstrapRecoveryPromise) return bootstrapRecoveryPromise;
    bootstrapRecoveryPromise = service
      .recoverInFlightTasks({ mode: 'automatic' })
      .then(() => {
        bootstrapRecoveryPending = false;
        bootstrapRecoveryAttempts = 0;
      })
      .catch((error) => {
        console.warn('[TaskService] bootstrap recovery failed:', error);
        scheduleBootstrapRecovery();
      })
      .finally(() => {
        bootstrapRecoveryPromise = undefined;
      });
    return bootstrapRecoveryPromise;
  };

  const notifyForDelivery = async (
    notification: TaskServiceNotification
  ): Promise<TaskServiceDeliveryConfirmation> => {
    const results = await Promise.all(
      [...listeners].map((listener) => Promise.resolve(listener(notification)))
    );
    return {
      deliveredTaskIds: results.flatMap((result) => result?.deliveredTaskIds ?? []),
      handledEventIds: results.flatMap((result) => result?.handledEventIds ?? []),
    };
  };
  const notify = async (notification: TaskServiceNotification): Promise<void> => {
    await notifyForDelivery(notification);
  };

  const applyInboxEvent = (
    event: WorkspaceTaskInboxEvent
  ): TaskStateApplicationResult | 'handled' => {
    if (
      event.eventType === WorkspaceTaskInboxEventType.TaskDeleted ||
      event.task.status === 'completed'
    ) {
      taskInboxState.remove(event.chatroomId, event.role, event.taskId, event.task.updatedAt);
      clearRedeliveryTrackingForTask(event.chatroomId, event.role, event.taskId);
      return 'handled';
    }

    // A fresh assignment (new task or reassignment to this role) starts a new
    // redelivery cycle. TaskUpdated transitions emitted by the daemon itself
    // (release/claim) must not reset the V2 counter.
    if (event.eventType === WorkspaceTaskInboxEventType.TaskAssigned) {
      clearRedeliveryTrackingForTask(event.chatroomId, event.role, event.taskId);
    }

    return taskInboxState.upsert([
      {
        taskId: event.task.taskId,
        chatroomId: event.task.chatroomId,
        status: event.task.status as AssignedTask['status'],
        assignedTo: event.task.assignedTo,
        updatedAt: event.task.updatedAt,
        createdAt: event.task.createdAt,
        requestsNativeColdSession: event.task.startInNewSession,
        agentConfig: {
          role: event.role,
          machineId: event.machineId,
        },
        assignee: event.assignee,
      },
    ]);
  };

  const taskKey = (event: WorkspaceTaskInboxEvent): string =>
    `${event.chatroomId}:${event.role.toLowerCase()}:${event.taskId}`;

  /**
   * Delivery and acknowledgement are separate failure boundaries. If the
   * acknowledgement fails after delivery, retrying it must not redeliver.
   */
  const acknowledgeEvent = async (event: WorkspaceTaskInboxEvent): Promise<void> => {
    try {
      await gateway.markTaskInboxEventProcessed({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        eventId: event.eventId,
      });
    } catch (error) {
      console.warn('[TaskService] task inbox acknowledgement failed:', error);
      acknowledgementRetryWatcher.schedule(event.eventId);
    }
  };

  /** Queue one event behind other events for the same chatroom, role, and task. */
  const scheduleEvent = (event: WorkspaceTaskInboxEvent): Promise<void> => {
    if (
      inboxStopped ||
      deliveredEventIds.has(event.eventId) ||
      scheduledEventIds.has(event.eventId)
    ) {
      return Promise.resolve();
    }

    scheduledEventIds.add(event.eventId);
    const previous = taskChains.get(taskKey(event)) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(async () => {
        try {
          const application = applyInboxEvent(event);
          if (application === 'handled' || application === 'tombstoned') {
            await gateway.clearDeliveryFailure({
              sessionId: deps.sessionId,
              machineId: deps.machineId,
              taskId: event.taskId,
              expectedReason: 'task_not_deliverable',
            });
            deliveredEventIds.add(event.eventId);
            await acknowledgeEvent(event);
            return;
          }
          if (application === 'stale') {
            await notifyForDelivery({ kind: 'inbox-event', event });
            deliveredEventIds.add(event.eventId);
            await acknowledgeEvent(event);
            return;
          }
          const currentTask = taskInboxState.getForRole(event.chatroomId, event.role, event.taskId);
          if (currentTask?.status === 'pending' || currentTask?.status === 'acknowledged') {
            pendingTaskReconciliationWatcher.watch(currentTask);
          } else {
            pendingTaskReconciliationWatcher.clear(event.chatroomId, event.role, event.taskId);
          }
          const confirmation = await notifyForDelivery({ kind: 'inbox-event', event });
          const handledWithoutDelivery =
            confirmation.handledEventIds?.includes(event.eventId) ?? false;
          const delivered = confirmation.deliveredTaskIds?.includes(event.taskId) ?? false;
          if (!handledWithoutDelivery && !delivered) {
            deliveryRetryWatcher.schedule(event.eventId);
            return;
          }
          deliveredEventIds.add(event.eventId);
        } catch (error) {
          console.warn('[TaskService] task inbox delivery failed:', error);
          deliveryRetryWatcher.schedule(event.eventId);
          return;
        } finally {
          scheduledEventIds.delete(event.eventId);
        }
        await acknowledgeEvent(event);
      });
    taskChains.set(taskKey(event), current);
    void current.finally(() => {
      if (taskChains.get(taskKey(event)) === current) taskChains.delete(taskKey(event));
    });
    return current;
  };

  const deliveryRetryWatcher = createTaskInboxDeliveryRetryWatcher({
    isStopped: () => inboxStopped,
    hasPendingEvent: (eventId) => pendingEvents.has(eventId),
    retry: (eventId) => {
      const event = pendingEvents.get(eventId);
      if (event) void scheduleEvent(event);
    },
  });

  const acknowledgementRetryWatcher = createTaskInboxAcknowledgementRetryWatcher({
    isStopped: () => inboxStopped,
    hasPendingEvent: (eventId) => pendingEvents.has(eventId),
    retry: (eventId) => {
      const event = pendingEvents.get(eventId);
      if (event) void acknowledgeEvent(event);
    },
  });

  const reconcileTaskStatuses = (tasks: readonly AssignedTask[]): void => {
    taskInboxState.reconcileStatuses(tasks);
    void runBootstrapRecovery();
    for (const task of tasks) {
      if (task.status === 'pending' || task.status === 'acknowledged') {
        pendingTaskReconciliationWatcher.watch(task);
      } else {
        pendingTaskReconciliationWatcher.clear(task.chatroomId, task.agentConfig.role, task.taskId);
      }
    }
  };

  const pendingTaskReconciliationWatcher = createPendingTaskReconciliationWatcher({
    taskState: taskInboxState,
    notify,
    isStopped: () => inboxStopped,
  });

  /** Reconcile a reactive snapshot and schedule only newly observed events. */
  const reconcilePendingEvents = (events: readonly WorkspaceTaskInboxEvent[]): Promise<void> => {
    const nextIds = new Set(events.map((event) => event.eventId));
    for (const eventId of pendingEvents.keys()) {
      if (!nextIds.has(eventId)) {
        pendingEvents.delete(eventId);
        deliveredEventIds.delete(eventId);
        deliveryRetryWatcher.clear(eventId);
        acknowledgementRetryWatcher.clear(eventId);
      }
    }
    return Promise.all(
      events.map((event) => {
        pendingEvents.set(event.eventId, event);
        return scheduleEvent(event);
      })
    ).then(() => undefined);
  };

  const service: TaskService = {
    startTaskInbox: async (wsClient) => {
      inboxStopped = false;
      try {
        const statusTasks = await gateway.listActiveTaskStatuses({
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        });
        reconcileTaskStatuses(statusTasks);
        await runBootstrapRecovery();
      } catch (error) {
        console.warn('[TaskService] task-status bootstrap failed:', error);
        bootstrapRecoveryPending = true;
        await runBootstrapRecovery();
      }
      if (wsClient && !stopInboxWatch) {
        stopInboxWatch = wsClient.onUpdate(
          api.chatroomWorkspaceTaskInbox.listPending,
          { sessionId: deps.sessionId as SessionId, machineId: deps.machineId },
          (rows) => {
            void reconcilePendingEvents(mapPendingTaskInboxRows(rows));
          },
          (error) => console.warn(`[daemon] task-inbox watch error: ${String(error)}`)
        );
        if (!stopTaskStatusWatch) {
          stopTaskStatusWatch = wsClient.onUpdate(
            api.daemon.taskStatus.listActive,
            { sessionId: deps.sessionId as SessionId, machineId: deps.machineId },
            (tasks) => reconcileTaskStatuses(tasks as AssignedTask[]),
            (error) => console.warn(`[daemon] task-status watch error: ${String(error)}`)
          );
        }
      } else if (!wsClient) {
        const events = await gateway.listPendingTaskInboxEvents({
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        });
        await reconcilePendingEvents(events);
      }
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stopTaskInbox: () => {
      inboxStopped = true;
      for (const timer of rearmTimers.values()) clearTimeout(timer);
      rearmTimers.clear();
      rearmCycleCounts.clear();
      pendingTurnFailureReleases.clear();
      if (bootstrapRecoveryTimer) clearTimeout(bootstrapRecoveryTimer);
      bootstrapRecoveryTimer = undefined;
      stopInboxWatch?.();
      stopInboxWatch = undefined;
      stopTaskStatusWatch?.();
      stopTaskStatusWatch = undefined;
      pendingEvents.clear();
      scheduledEventIds.clear();
      deliveredEventIds.clear();
      deliveryRetryWatcher.stop();
      acknowledgementRetryWatcher.stop();
      pendingTaskReconciliationWatcher.stop();
      taskChains.clear();
      handoffRepository.close();
    },
    listTasksForRole: (chatroomId, role) => taskInboxState.listForRole(chatroomId, role),
    listAllTasks: () => taskInboxState.listAll(),
    listMachineTaskRolesForChatroom: async (chatroomId) => {
      const statuses = await gateway.listActiveTaskStatuses({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
      });
      return [
        ...new Set(
          statuses
            .filter(
              (task) =>
                task.chatroomId.toLowerCase() === chatroomId.toLowerCase() &&
                task.agentConfig.machineId.toLowerCase() === deps.machineId.toLowerCase() &&
                task.assignedTo?.toLowerCase() === task.agentConfig.role.toLowerCase()
            )
            .map((task) => task.agentConfig.role.toLowerCase())
        ),
      ];
    },
    debugState: (chatroomId) => buildTaskServiceDebugState({ taskInboxState, chatroomId }),
    taskInboxState,
    recordHandoffOutcome: async ({
      chatroomId,
      role,
      targetRole,
      nextTask,
      taskIds: providedTaskIds,
    }) => {
      const taskIds =
        providedTaskIds ??
        taskInboxState
          .listForRole(chatroomId, role)
          .filter((task) => task.status === 'acknowledged' || task.status === 'in_progress')
          .map((task) => task.taskId);
      await handoffRepository.record({
        chatroomId,
        role,
        taskIds,
        ...(nextTask?.taskId ? { nextTaskId: nextTask.taskId } : {}),
        targetRole,
        handedOffAt: Date.now(),
      });
      const now = Date.now();
      for (const taskId of taskIds) taskInboxState.remove(chatroomId, role, taskId, now);
      if (nextTask) taskInboxState.upsert([nextTask]);
    },
    getLatestHandoff: (chatroomId, role) => handoffRepository.getLatest(chatroomId, role),
    recoverInFlightTasks: async ({ chatroomId, role, mode }) => {
      if ((chatroomId === undefined) !== (role === undefined)) {
        throw new Error('chatroomId and role must be provided together');
      }
      if (mode === 'explicit' && (chatroomId === undefined || role === undefined)) {
        throw new Error('explicit task recovery requires chatroomId and role');
      }

      const selectedRole = role?.toLowerCase();
      if (mode === 'explicit' && chatroomId !== undefined && role !== undefined) {
        clearRoleRedeliveryTracking(chatroomId, role);
      }

      let statuses: readonly AssignedTask[];
      try {
        statuses = await gateway.listActiveTaskStatuses({
          sessionId: deps.sessionId,
          machineId: deps.machineId,
        });
      } catch (error) {
        console.warn(
          `[TaskService] in-flight recovery failed phase=read chatroom=${chatroomId ?? '*'} role=${role ?? '*'}: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }

      let released = 0;
      let skipped = 0;
      const latestHandoffs = new Map<string, Promise<TaskHandoffRecord | null>>();
      const candidates: AssignedTask[] = [];
      let selectingTask: AssignedTask | undefined;
      try {
        for (const task of statuses) {
          selectingTask = task;
          const taskRole = task.agentConfig.role;
          const normalizedTaskRole = taskRole.toLowerCase();
          const matches =
            task.agentConfig.machineId === deps.machineId &&
            (task.status === 'acknowledged' || task.status === 'in_progress') &&
            (chatroomId === undefined || task.chatroomId === chatroomId) &&
            (selectedRole === undefined || normalizedTaskRole === selectedRole) &&
            task.assignedTo?.toLowerCase() === normalizedTaskRole;
          if (!matches) {
            skipped += 1;
            continue;
          }
          if (mode === 'automatic') {
            const tracking = { chatroomId: task.chatroomId, role: taskRole, taskId: task.taskId };
            const key = redeliveryKey(task.chatroomId, taskRole, task.taskId);
            // Exhausted keys already imply a re-arm cooldown, but check the timer
            // explicitly so the guard does not depend on that invariant. A slice-1
            // backoff release waiting in the work manager is also off limits to
            // automatic recovery; manual (explicit) recovery deliberately bypasses both.
            if (
              isRedeliveryExhausted(tracking) ||
              rearmTimers.has(key) ||
              pendingTurnFailureReleases.has(key)
            ) {
              skipped += 1;
              continue;
            }
            const handoffKey = `${task.chatroomId}:${normalizedTaskRole}`;
            let latest = latestHandoffs.get(handoffKey);
            if (!latest) {
              latest = handoffRepository.getLatest(task.chatroomId, taskRole);
              latestHandoffs.set(handoffKey, latest);
            }
            if ((await latest)?.taskIds.includes(task.taskId)) {
              skipped += 1;
              continue;
            }
          }
          candidates.push(task);
        }
      } catch (error) {
        console.warn(
          `[TaskService] in-flight recovery failed phase=select chatroom=${selectingTask?.chatroomId ?? chatroomId ?? '*'} role=${selectingTask?.agentConfig.role ?? role ?? '*'} task=${selectingTask?.taskId ?? '*'} released=${released} skipped=${skipped}: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }

      let currentTask: AssignedTask | undefined;
      try {
        for (const task of candidates) {
          currentTask = task;
          const result = await releaseTask({
            chatroomId: task.chatroomId,
            role: task.agentConfig.role,
            taskId: task.taskId,
          });
          if (result.released) released += 1;
          else skipped += 1;
        }
      } catch (error) {
        console.warn(
          `[TaskService] in-flight recovery failed phase=release chatroom=${currentTask?.chatroomId ?? chatroomId ?? '*'} role=${currentTask?.agentConfig.role ?? role ?? '*'} task=${currentTask?.taskId ?? '*'} released=${released} skipped=${skipped}: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
      }
      console.log(
        `[TaskService] in-flight recovery complete mode=${mode} chatroom=${chatroomId ?? '*'} role=${role ?? '*'} released=${released} skipped=${skipped}`
      );
      return { released, skipped };
    },
    releaseTaskAfterTurnFailure: (args) => releaseTask(args),
    loadAssignedTaskForAction: async ({ chatroomId, role, taskId }) => {
      const task = await gateway.loadAssignedTaskForAction({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        taskId,
        role,
      });
      return task?.chatroomId === chatroomId ? task : null;
    },
    handleAgentTurnProgress: async ({ chatroomId, role, taskId }) => {
      const task = taskInboxState.getForRole(chatroomId, role, taskId);
      if (!task) return;
      if (task.status !== 'acknowledged' && task.status !== 'in_progress') return;

      if (task.status === 'acknowledged') {
        try {
          await gateway.readTask({ sessionId: deps.sessionId, chatroomId, role, taskId });
          taskInboxState.markStatus(chatroomId, role, taskId, 'in_progress', Date.now());
        } catch (error) {
          console.warn(
            `[TaskService] turn-progress read failed chatroom=${chatroomId} role=${role} task=${taskId}: ${error instanceof Error ? error.message : String(error)}`
          );
          return;
        }
      }

      // The receipt may still be open (e.g. readTask succeeded but the receipt
      // mark failed on an earlier progress signal) — markStarted is a no-op
      // when nothing is open.
      try {
        await gateway.markReceiptStarted({ sessionId: deps.sessionId, chatroomId, role, taskId });
      } catch (error) {
        console.warn(
          `[TaskService] turn-progress receipt mark failed chatroom=${chatroomId} role=${role} task=${taskId}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    },
    recordDeliveryFailure: ({ taskId, reason }) =>
      gateway.recordDeliveryFailure({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        taskId,
        reason,
      }),
    clearDeliveryFailure: (taskId, expectedReason) =>
      gateway.clearDeliveryFailure({
        sessionId: deps.sessionId,
        machineId: deps.machineId,
        taskId,
        ...(expectedReason ? { expectedReason } : {}),
      }),
    recordTurnFailure,
    decideUncoveredTurnEnd,
    confirmNudgeSent,
    resetTurnTracking,
    isRedeliveryExhausted,
    clearRedeliveryTracking: ({ chatroomId, role }) => {
      clearRoleRedeliveryTracking(chatroomId, role);
    },
    markTurnFailureReleasePending: ({ chatroomId, role, taskId }) => {
      pendingTurnFailureReleases.add(redeliveryKey(chatroomId, role, taskId));
    },
    clearTurnFailureReleasePending: ({ chatroomId, role, taskId }) => {
      pendingTurnFailureReleases.delete(redeliveryKey(chatroomId, role, taskId));
    },
    forgetStaleTask,
  };
  return service;
}
