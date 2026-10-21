// fallow-ignore-file complexity

import { AGENT_LIFECYCLE_OPERATION_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import {
  AgentStopReasonEnum,
  DaemonStartReasonCode,
} from '@workspace/backend/src/domain/entities/agent.js';
import { WorkspaceTaskInboxEventType } from '@workspace/backend/src/domain/entities/chatroom-workspace-task-inbox.js';
import { Effect } from 'effect';

import type { SerializedAgentOperations } from './agent-process-manager-service.js';
import type { EnsureAgentProcessInput } from './ports/agent-process-lifecycle.js';
import type { AgentHarness } from '../../../../infrastructure/machine/types.js';
import {
  buildAgentLifecycleRevisionKey,
  buildAgentStatusFact,
  type AgentLifecycleFact,
} from '../../../domain/entities/agent-lifecycle-fact.js';
import { AGENT_SLOT_STATE } from '../../../domain/entities/agent-slot.js';
import { ACTIVE_TASK_STATUSES, type AssignedTask } from '../../../domain/entities/assigned-task.js';
import { isSlotRunning, isTurnPhaseIdle } from '../../../domain/usecase/check-agent-slot.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../../entry/daemon-services.js';
import type { TaskInboxStateReader } from '../../../infrastructure/inbox/task-inbox-state.js';
import type { AgentConfigRegistry } from '../../chatroom-workspace-configuration-service/index.js';
import type {
  AgentStartedEvent,
  AgentSessionLostEvent,
  AgentTurnEndedEvent,
  AgentTurnDisposition,
  AgentTaskStateService,
  AgentProcessManagerService,
  NativeDeliverySessionHandles,
  TaskService,
} from '../../service-interfaces.js';
import { computeBackoffDelay } from '../../task-service/domain/usecase/compute-backoff-delay.js';
import {
  explainNativeDeliveryBlock,
  isNativeHarness,
} from '../../task-service/domain/usecase/native-task-injector-logic.js';
import { buildUncoveredTurnNudgePrompt } from '../../task-service/domain/usecase/uncovered-turn-nudge.js';
import type {
  TaskServiceDeliveryConfirmation,
  TaskServiceNotification,
} from '../../task-service/index.js';
import { createConvexNativeTaskDeliveryGateway } from '../../task-service/infrastructure/adapters/convex-native-task-delivery-gateway.js';
import { createDaemonAuditPort } from '../../task-service/infrastructure/adapters/daemon-audit-port.js';
import { getRoleDeliveryState } from '../../task-service/service/native-delivery/role-delivery-state.js';
import {
  processTasksUpdate,
  type TaskDeliveryLifecycleArgs,
} from '../../task-service/service/native-delivery/task-delivery-processor.js';
import type { TaskDeliveryService } from '../../task-service/service/native-delivery/task-delivery-service.js';
import { NativeTaskDeliveryQueue } from '../../task-service/service/native-task-delivery-queue.js';
import { runNativeInjectionEffect } from '../../task-service/service/native-task-injector.js';

/** Starts allowed for one uncovered-turn restart: the first attempt plus two retries. */
const MAX_RESPAWN_START_ATTEMPTS = 3;

/** Nudge sends allowed for one uncovered turn end: the first try plus two retries, then escalate. */
const MAX_UNCOVERED_NUDGE_SEND_ATTEMPTS = 3;

/** Delay before retrying a nudge whose delivery mutex was busy, to let the holder release it. */
const UNCOVERED_NUDGE_RETRY_MS = 250;

interface RespawnStartRequest {
  readonly chatroomId: string;
  readonly role: string;
  readonly workingDir: string;
  readonly startInput: EnsureAgentProcessInput;
}

/** A respawn whose start failed and still has retries left. */
interface PendingRespawnStart {
  /** Identifies this restart intent. A retry runs only while the same intent is pending. */
  readonly restartId: number;
  readonly request: RespawnStartRequest;
  /** Start calls made so far, including the first attempt inside the restart. */
  attempts: number;
  timer?: ReturnType<typeof setTimeout> | undefined;
}

type RespawnStartOutcome =
  | { readonly kind: 'started' }
  | { readonly kind: 'start-failed'; readonly error: string }
  | { readonly kind: 'skipped'; readonly reason: string };

export type AgentWorkPass =
  | 'inbox-event'
  | 'periodic-reconcile'
  | 'bootstrap'
  | 'agent-session-lost'
  | 'agent-started'
  | 'turn-ended'
  | 'restart-completed';

export type AgentTaskDeliveredHandler = (args: TaskDeliveryLifecycleArgs) => void;

export interface AgentWorkManagerDependencies {
  /** Workspace configuration source for delivery-time agent runtime config. */
  readonly configurationService: AgentConfigRegistry;
  readonly agentMgr: DaemonAgentProcessManagerServiceShape;
  readonly runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
  readonly acquireNativeDeliverySlot: AgentProcessManagerService['acquireNativeDeliverySlot'];
  readonly sessionDeps: NativeDeliverySessionHandles & { convexUrl: string };
  readonly machineId: string;
  /** Read-only task inbox state owned and mutated by TaskService. */
  readonly taskInboxState: TaskInboxStateReader;
  readonly agentTaskState: AgentTaskStateService;
  readonly lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
  readonly taskService: TaskService;
}

type RoleRecoveryGate = {
  readonly drainPromise: Promise<void>;
  readonly completion: Promise<void>;
  readonly resolveCompletion: () => void;
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  retryAttempts: number;
  recoveryPromise: Promise<{ released: number }> | undefined;
};

const recoveryKey = (chatroomId: string, role: string): string =>
  `${chatroomId}:${role.toLowerCase()}`;

/** Identifies a provider-failure release that is waiting out its backoff delay. */
type TurnFailureReleaseKey = {
  readonly chatroomId: string;
  readonly role: string;
  readonly taskId: string;
};

const turnFailureReleaseKey = ({ chatroomId, role, taskId }: TurnFailureReleaseKey): string =>
  `${chatroomId}:${role.toLowerCase()}:${taskId}`;

/** Identifies one harness session of one agent process. A new key re-arms the uncovered-turn nudge. */
const sessionKeyFor = (pid: number, harnessSessionId: string | undefined): string =>
  `${pid}:${harnessSessionId ?? 'none'}`;

/**
 * Per-daemon native delivery application service.
 *
 * This is the composition boundary for task inbox updates. Callers provide a
 * constructed instance instead of resolving delivery dependencies through the
 * module-level session registry.
 */
export class AgentWorkManager {
  private readonly unsubscribeAgentTurnEnded: () => void;
  private readonly unsubscribeAgentStarted: () => void;
  private readonly unsubscribeAgentSessionLost: () => void;
  private readonly unsubscribeAgentTurnProgress: () => void;
  private readonly reconcileStates = new Map<
    string,
    {
      pendingSource: AgentWorkPass | undefined;
      promise: Promise<readonly string[]>;
    }
  >();
  private unsubscribeTaskService: (() => void) | undefined;
  private readonly nativeTaskDeliveryQueue: NativeTaskDeliveryQueue;
  private readonly deliveryTaskService: TaskDeliveryService;
  private readonly recoveryGates = new Map<string, RoleRecoveryGate>();
  /** Respawn starts that failed and still have retries, per role. Cleared on success, exhaustion, or cancellation. */
  private readonly respawnStartRetries = new Map<string, PendingRespawnStart>();
  private respawnRestartSeq = 0;
  /**
   * Provider-failure releases waiting out their exponential backoff, keyed by
   * `chatroom:role:taskId`. In-memory on purpose: a daemon restart clears both
   * the timers and the in-memory attempt budget (known limitation).
   */
  private readonly turnFailureReleaseTimers = new Map<
    string,
    { readonly key: TurnFailureReleaseKey; readonly timer: ReturnType<typeof setTimeout> }
  >();
  private disposed = false;

  constructor(private readonly deps: AgentWorkManagerDependencies) {
    const gateway = createConvexNativeTaskDeliveryGateway(deps.sessionDeps.backend);
    const audit = createDaemonAuditPort(deps.sessionDeps.logEvent ?? (async () => undefined));
    this.nativeTaskDeliveryQueue = new NativeTaskDeliveryQueue(async (entry) => {
      await Effect.runPromise(
        runNativeInjectionEffect(entry.task, entry.harnessSessionId, {
          ...deps.sessionDeps,
          convexUrl: deps.sessionDeps.convexUrl,
          configurationService: deps.configurationService,
          agentMgr: {
            resumeTurnForSlot: (args) => Effect.runPromise(deps.agentMgr.resumeTurnForSlot(args)),
            getSlot: (chatroomId, role) => deps.agentMgr.getSlot(chatroomId, role),
            isStopRequested: (chatroomId, role) => deps.agentMgr.isStopRequested(chatroomId, role),
          },
          taskGateway: gateway,
          audit,
          runSerializedForAgent: deps.runSerializedForAgent,
          lifecycleOutbox: deps.lifecycleOutbox,
          onTaskDelivered: entry.onTaskDelivered,
          ...(entry.isCurrent ? { isCurrent: entry.isCurrent } : {}),
        })
      );
    });
    this.deliveryTaskService = {
      isNativeHarness,
      explainNativeDeliveryBlock,
      releaseTaskAfterTurnFailure: deps.taskService.releaseTaskAfterTurnFailure,
      recordDeliveryFailure: deps.taskService.recordDeliveryFailure,
      clearDeliveryFailure: deps.taskService.clearDeliveryFailure,
      recordTurnFailure: deps.taskService.recordTurnFailure,
      decideUncoveredTurnEnd: deps.taskService.decideUncoveredTurnEnd,
      confirmNudgeSent: deps.taskService.confirmNudgeSent,
      resetTurnTracking: deps.taskService.resetTurnTracking,
      isRedeliveryExhausted: deps.taskService.isRedeliveryExhausted,
      clearRedeliveryTracking: deps.taskService.clearRedeliveryTracking,
      markTurnFailureReleasePending: deps.taskService.markTurnFailureReleasePending,
      clearTurnFailureReleasePending: deps.taskService.clearTurnFailureReleasePending,
      forgetStaleTask: deps.taskService.forgetStaleTask,
      loadAssignedTaskForAction: deps.taskService.loadAssignedTaskForAction,
      deliverNativeTask: (task, harnessSessionId, onTaskDelivered, isCurrent) =>
        this.nativeTaskDeliveryQueue.enqueue({
          task,
          harnessSessionId,
          onTaskDelivered,
          isCurrent,
        }),
    };
    this.unsubscribeAgentTurnEnded = deps.agentMgr.subscribeAgentTurnEnded((event) =>
      this.handleAgentTurnEnded(event)
    );
    this.unsubscribeAgentStarted = deps.agentMgr.subscribeAgentStarted((event) =>
      this.handleAgentStarted(event)
    );
    this.unsubscribeAgentSessionLost = deps.agentMgr.subscribeAgentSessionLost((event) =>
      this.handleAgentSessionLost(event)
    );
    this.unsubscribeAgentTurnProgress = deps.agentMgr.subscribeAgentTurnProgress((event) => {
      const activeTask = this.deps.agentTaskState.get(event);
      if (!activeTask) return;
      void this.deps.taskService
        .handleAgentTurnProgress({ ...event, taskId: activeTask.taskId })
        .catch((error: unknown) => {
          console.warn(
            `[AgentProcessManager] turn-progress handling failed for ${event.role}@${event.chatroomId}: ${error instanceof Error ? error.message : String(error)}`
          );
        });
    });
    this.unsubscribeTaskService = deps.taskService.subscribe((notification) =>
      this.handleTaskServiceNotification(notification)
    );
  }

  async handleAgentStarted(event: AgentStartedEvent): Promise<void> {
    // A start for this role means the agent is running again, so any pending respawn retry is moot.
    this.cancelRespawnStart(
      recoveryKey(event.chatroomId, event.role),
      `agent_started:${event.reason ?? 'unknown'}`
    );
    await this.waitForRoleRecovery(event.chatroomId, event.role);
    // A new agent process/session cannot still be executing the task recorded
    // by the previous process. Clear the local dedup marker before the first
    // post-start reconciliation so a stop/start cycle can recover delivery.
    this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
    // A user-initiated agent restart is an explicit intervention: reset the V2
    // redelivery attempt cap so delivery can be retried (plan V2).
    if (event.reason === 'user.start') {
      this.deps.taskService.clearRedeliveryTracking({
        chatroomId: event.chatroomId,
        role: event.role,
      });
    }
    // A user start/restart supersedes any provider-failure release still waiting
    // out its backoff; the counter and the timer reset together.
    if (event.reason === 'user.start' || event.reason === 'user.restart') {
      this.cancelTurnFailureReleasesForRole(event.chatroomId, event.role);
    }
    await this.requestReconcile({
      chatroomId: event.chatroomId,
      role: event.role,
      source: 'agent-started',
    });
  }

  private canReconcileRole(chatroomId: string, role: string): boolean {
    if (this.deps.agentMgr.isStopRequested(chatroomId, role)) return false;
    const slot = this.deps.agentMgr.getSlot(chatroomId, role);
    return (
      slot?.state === AGENT_SLOT_STATE.SPAWNING ||
      (slot?.state === AGENT_SLOT_STATE.RUNNING && slot.pid !== undefined)
    );
  }

  handleAgentSessionLost(event: AgentSessionLostEvent): void {
    if (this.disposed) return;
    const slot = this.deps.agentMgr.getSlot(event.chatroomId, event.role);
    if (
      slot?.pid !== event.pid ||
      (event.harnessSessionId !== undefined && slot?.harnessSessionId !== event.harnessSessionId)
    )
      return;
    const key = recoveryKey(event.chatroomId, event.role);
    if (this.recoveryGates.has(key)) return;
    void this.prepareRoleRecovery({ chatroomId: event.chatroomId, role: event.role })
      .then(() =>
        this.recoverStoppedRole({
          chatroomId: event.chatroomId,
          role: event.role,
          mode: 'automatic',
        })
      )
      .catch((error: unknown) => {
        console.warn(
          `[AgentWorkManager] recovery failed room=${event.chatroomId} role=${event.role} phase=automatic error=${error instanceof Error ? error.message : String(error)}`
        );
        this.scheduleRecoveryRetry(event.chatroomId, event.role);
      });
  }

  async prepareRoleRecovery(args: { chatroomId: string; role: string }): Promise<void> {
    const key = recoveryKey(args.chatroomId, args.role);
    const existing = this.recoveryGates.get(key);
    if (existing) return existing.drainPromise;
    let resolveCompletion!: () => void;
    const completion = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });
    getRoleDeliveryState().resetDeliveryState(args.chatroomId, args.role);
    const drainPromise = this.nativeTaskDeliveryQueue.invalidateRole(args.chatroomId, args.role);
    const gate: RoleRecoveryGate = {
      drainPromise,
      completion,
      resolveCompletion,
      retryAttempts: 0,
      retryTimer: undefined,
      recoveryPromise: undefined,
    };
    this.recoveryGates.set(key, gate);
    await drainPromise;
    if (this.recoveryGates.get(key) === gate) {
      this.deps.agentTaskState.clear(args);
    }
  }

  async recoverStoppedRole(args: {
    chatroomId: string;
    role: string;
    mode: 'automatic' | 'explicit';
  }): Promise<{ released: number }> {
    const key = recoveryKey(args.chatroomId, args.role);
    let gate = this.recoveryGates.get(key);
    if (!gate)
      throw new Error(`role recovery gate not prepared for ${args.role}@${args.chatroomId}`);

    // An explicit request must not reuse an automatic run: the automatic selector
    // skipped tasks whose backoff marker was set, so its result is not an
    // explicit recovery. Let it finish, re-open the gate if it closed it, then
    // run a fresh explicit pass below.
    while (gate.recoveryPromise) {
      if (args.mode !== 'explicit') return gate.recoveryPromise;
      await gate.recoveryPromise.catch(() => undefined);
      if (!this.recoveryGates.has(key)) {
        await this.prepareRoleRecovery({ chatroomId: args.chatroomId, role: args.role });
      }
      const nextGate = this.recoveryGates.get(key);
      if (!nextGate)
        throw new Error(`role recovery gate not prepared for ${args.role}@${args.chatroomId}`);
      gate = nextGate;
    }

    gate.recoveryPromise = (async () => {
      await gate.drainPromise;
      const result = await this.deps.taskService.recoverInFlightTasks(args);
      // Only after an explicit recovery actually succeeded may its waiting
      // releases be cancelled. A throw above leaves them armed.
      if (args.mode === 'explicit') {
        this.cancelTurnFailureReleasesForRole(args.chatroomId, args.role);
      }
      if (this.recoveryGates.get(key) === gate) {
        if (gate.retryTimer) clearTimeout(gate.retryTimer);
        this.recoveryGates.delete(key);
        gate.resolveCompletion();
        if (!this.disposed) {
          void this.requestReconcile({
            chatroomId: args.chatroomId,
            role: args.role,
            source: 'agent-session-lost',
          }).catch((error: unknown) => {
            console.warn(
              `[AgentWorkManager] post-recovery reconcile failed room=${args.chatroomId} role=${args.role}: ${error instanceof Error ? error.message : String(error)}`
            );
          });
        }
      }
      return { released: result.released };
    })();
    try {
      return await gate.recoveryPromise;
    } finally {
      gate.recoveryPromise = undefined;
    }
  }

  private async waitForRoleRecovery(chatroomId: string, role: string): Promise<void> {
    while (true) {
      const gate = this.recoveryGates.get(recoveryKey(chatroomId, role));
      if (!gate) return;
      await gate.completion;
    }
  }

  private scheduleRecoveryRetry(chatroomId: string, role: string): void {
    const gate = this.recoveryGates.get(recoveryKey(chatroomId, role));
    if (!gate || gate.retryTimer || this.disposed) return;
    const delay = Math.min(30_000, 1_000 * 2 ** gate.retryAttempts++);
    gate.retryTimer = setTimeout(() => {
      gate.retryTimer = undefined;
      void this.recoverStoppedRole({ chatroomId, role, mode: 'automatic' }).catch(
        (error: unknown) => {
          console.warn(
            `[AgentWorkManager] recovery retry failed room=${chatroomId} role=${role} phase=automatic error=${error instanceof Error ? error.message : String(error)}`
          );
          this.scheduleRecoveryRetry(chatroomId, role);
        }
      );
    }, delay);
  }

  /**
   * Plan V2 shared turn-end recovery: counts the provider failure toward the
   * consecutive-attempt cap, then schedules the release after an exponential
   * backoff instead of releasing inside the turn-ended handler. Waiting keeps
   * the task `in_progress` (not deliverable) while the provider recovers.
   * Returns `exceeded` when the task was parked and no release is scheduled.
   */
  private async recoverTaskAfterTurnFailure(
    event: AgentTurnEndedEvent,
    activeTask: { taskId: string }
  ): Promise<'scheduled' | 'exceeded'> {
    const { chatroomId, role } = event;
    const { attempts, exceeded } = await this.deps.taskService.recordTurnFailure({
      chatroomId,
      role,
      taskId: activeTask.taskId,
    });
    if (exceeded) {
      // Parking supersedes any release still waiting from an earlier failure.
      this.cancelTurnFailureRelease({
        chatroomId,
        role,
        taskId: activeTask.taskId,
      });
      return 'exceeded';
    }

    this.scheduleTurnFailureRelease(
      { chatroomId, role, taskId: activeTask.taskId },
      attempts,
      event.completion.turnId
    );
    return 'scheduled';
  }

  /**
   * Waits `computeBackoffDelay(attempt)` before releasing the task back to
   * `pending`. A newer failure for the same task replaces the pending timer so
   * only the latest attempt's delay applies.
   */
  private scheduleTurnFailureRelease(
    key: TurnFailureReleaseKey,
    attempt: number,
    turnId: string
  ): void {
    if (this.disposed) return;
    this.cancelTurnFailureRelease(key);
    const keyStr = turnFailureReleaseKey(key);
    const delay = computeBackoffDelay(attempt);
    // Tell the task service a release is waiting so automatic recovery does not
    // bypass the remaining backoff.
    this.deps.taskService.markTurnFailureReleasePending(key);
    const timer = setTimeout(() => {
      this.turnFailureReleaseTimers.delete(keyStr);
      this.deps.taskService.clearTurnFailureReleasePending(key);
      if (this.disposed) return;
      void this.releaseAfterTurnFailureBackoff(key);
    }, delay);
    this.turnFailureReleaseTimers.set(keyStr, { key, timer });
    console.log(
      `[NativeDelivery:turn-failure-backoff] chatroom=${key.chatroomId} role=${key.role} task=${key.taskId} turn=${turnId} attempt=${attempt} delayMs=${delay}`
    );
  }

  /**
   * Releases a task whose backoff elapsed, but only while it is still the same
   * in-flight task for this role. The turn-ended handler cleared the active
   * task state, so the inbox read model (task id + `in_progress`) is the
   * authority here.
   */
  private async releaseAfterTurnFailureBackoff(key: TurnFailureReleaseKey): Promise<void> {
    const current = this.deps.taskInboxState.getForRole(key.chatroomId, key.role, key.taskId);
    if (!current || current.status !== 'in_progress') {
      console.log(
        `[NativeDelivery:turn-failure-release-skipped] chatroom=${key.chatroomId} role=${key.role} task=${key.taskId} reason=task_not_current status=${current?.status ?? 'missing'}`
      );
      return;
    }
    const activeTask = this.deps.agentTaskState.get({
      chatroomId: key.chatroomId,
      role: key.role,
    });
    if (activeTask?.taskId === key.taskId) {
      console.log(
        `[NativeDelivery:turn-failure-release-skipped] chatroom=${key.chatroomId} role=${key.role} task=${key.taskId} reason=task_active`
      );
      return;
    }
    try {
      await this.deps.taskService.releaseTaskAfterTurnFailure({
        chatroomId: key.chatroomId,
        role: key.role,
        taskId: key.taskId,
      });
    } catch (error) {
      console.error(
        `[NativeDelivery:turn-failed-release-error] chatroom=${key.chatroomId} role=${key.role} task=${key.taskId} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      );
      await this.retryReleaseAfterFailure(key);
    }
  }

  /**
   * A failed backend release counts like another turn failure: retry with the
   * next backoff delay, or let the task service park the task once the cap is
   * reached. Nothing is left without a timer, a marker, or a park.
   */
  private async retryReleaseAfterFailure(key: TurnFailureReleaseKey): Promise<void> {
    try {
      const { attempts, exceeded } = await this.deps.taskService.recordTurnFailure(key);
      if (exceeded) return;
      this.scheduleTurnFailureRelease(key, attempts, 'release-retry');
    } catch (error) {
      console.error(
        `[NativeDelivery:turn-failed-release-retry-error] chatroom=${key.chatroomId} role=${key.role} task=${key.taskId} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      );
    }
  }

  /** Stops a pending provider-failure release. A no-op when nothing is pending. */
  private cancelTurnFailureRelease(key: TurnFailureReleaseKey): void {
    const keyStr = turnFailureReleaseKey(key);
    const entry = this.turnFailureReleaseTimers.get(keyStr);
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    this.turnFailureReleaseTimers.delete(keyStr);
    this.deps.taskService.clearTurnFailureReleasePending(key);
  }

  /** Stops every pending provider-failure release for one role. */
  private cancelTurnFailureReleasesForRole(chatroomId: string, role: string): void {
    const prefix = `${chatroomId}:${role.toLowerCase()}:`;
    for (const [keyStr, entry] of [...this.turnFailureReleaseTimers]) {
      if (!keyStr.startsWith(prefix)) continue;
      clearTimeout(entry.timer);
      this.turnFailureReleaseTimers.delete(keyStr);
      this.deps.taskService.clearTurnFailureReleasePending(entry.key);
    }
  }

  async handleAgentTurnEnded(event: AgentTurnEndedEvent): Promise<AgentTurnDisposition> {
    const completion = event.completion;
    if (completion.status !== 'completed') {
      const activeTask = this.deps.agentTaskState.get({
        chatroomId: event.chatroomId,
        role: event.role,
      });
      const errorDetail = completion.error;
      console.error(
        `[NativeDelivery:turn-failed] chatroom=${event.chatroomId} role=${event.role} task=${activeTask?.taskId ?? 'none'} turn=${completion.turnId} status=${completion.status} source=${completion.source} error=${errorDetail ?? 'none'}`
      );
      if (activeTask) {
        // Plan V2: a failed turn without a covering handoff counts toward the
        // consecutive-attempt cap; at the cap the task is parked with a
        // user-visible delivery failure. Below the cap the release is deferred
        // by exponential backoff, so the attempt budget spans a provider outage.
        const recovery = await this.recoverTaskAfterTurnFailure(event, activeTask);
        if (recovery === 'exceeded') {
          this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
          return { kind: 'release-slot' };
        }
        this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
      }
      const fact: AgentLifecycleFact = {
        kind: 'turn_failed',
        chatroomId: event.chatroomId,
        role: event.role,
        ...(activeTask?.taskId ? { taskId: activeTask.taskId } : {}),
        ...(event.slot.harnessSessionId ? { harnessSessionId: event.slot.harnessSessionId } : {}),
        turnId: completion.turnId,
        status: completion.status,
        source: completion.source,
        ...(errorDetail ? { error: errorDetail } : {}),
        revisionKey: buildAgentLifecycleRevisionKey('turn_failed', {
          chatroomId: event.chatroomId,
          role: event.role,
          turnId: completion.turnId,
        }),
        emittedAt: Date.now(),
      };
      try {
        // Await only local persistence. A projection failure cannot hold an idle slot.
        await this.deps.lifecycleOutbox.enqueue(fact);
      } catch (error) {
        console.error(
          `[NativeDelivery:turn-failed-outbox-error] chatroom=${event.chatroomId} role=${event.role} turn=${completion.turnId} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
        );
      }
      return { kind: 'release-slot' };
    }
    // A completed turn without a covering handoff is never released to pending here.
    // The ladder nudges once per session, then parks the task (see decideUncoveredTurnEnd).
    const activeTask = this.deps.agentTaskState.get({
      chatroomId: event.chatroomId,
      role: event.role,
    });
    if (activeTask) {
      const handoff = await this.deps.taskService.getLatestHandoff(event.chatroomId, event.role);
      const covered = handoff?.taskIds.includes(activeTask.taskId) ?? false;
      if (covered) {
        this.deps.taskService.resetTurnTracking({
          chatroomId: event.chatroomId,
          role: event.role,
          taskId: activeTask.taskId,
        });
      } else {
        const decision = await this.deps.taskService.decideUncoveredTurnEnd({
          chatroomId: event.chatroomId,
          role: event.role,
          taskId: activeTask.taskId,
          sessionKey: sessionKeyFor(event.pid, event.slot.harnessSessionId),
        });
        if (decision.action === 'nudge') {
          // Keep agentTaskState: it blocks redelivery while the nudge is pending.
          await this.enqueueTurnEndedWaitingFact(event);
          this.scheduleUncoveredAction(event, activeTask, 'nudge');
          return { kind: 'release-slot' };
        }
        if (decision.action === 'restart-session') {
          // Keep agentTaskState: prepareRoleRecovery clears it inside the restart.
          await this.enqueueTurnEndedWaitingFact(event);
          this.scheduleUncoveredAction(event, activeTask, 'restart-session');
          return { kind: 'release-slot' };
        }
        // 'park'
        await this.enqueueTurnEndedWaitingFact(event);
        this.applyParkAction(event);
        return { kind: 'release-slot' };
      }
    }
    // Covered, or no active task: clear, then continue with the waiting fact and delivery.
    this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
    await this.enqueueTurnEndedWaitingFact(event);
    // The manager invokes this handler while the agent's lifecycle operation
    // is still serialized. Schedule delivery for the next turn of the event
    // loop so it cannot attempt to inject while that operation still owns the
    // per-agent boundary.
    this.scheduleRoleDelivery(event.chatroomId, event.role);
    return { kind: 'release-slot' };
  }

  /** Persists the 'waiting' status fact for a finished turn. Failures are logged, never thrown. */
  private async enqueueTurnEndedWaitingFact(event: AgentTurnEndedEvent): Promise<void> {
    try {
      await this.deps.lifecycleOutbox.enqueue(
        buildAgentStatusFact({
          chatroomId: event.chatroomId,
          role: event.role,
          status: 'waiting',
        })
      );
    } catch (error) {
      console.error(
        `[NativeDelivery:turn-ended-outbox-error] chatroom=${event.chatroomId} role=${event.role} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
      );
    }
  }

  /** Out-of-band, same discipline as scheduleRoleDelivery: run after the handler returns. */
  private scheduleUncoveredAction(
    event: AgentTurnEndedEvent,
    task: { taskId: string },
    action: 'nudge' | 'restart-session',
    attempt = 0,
    delayMs = 0
  ): void {
    setTimeout(() => {
      if (this.disposed) return;
      const run =
        action === 'nudge'
          ? this.sendUncoveredNudge(event, task, attempt)
          : this.restartSessionForUncoveredTask(event, task);
      void run.catch((error: unknown) => {
        console.error(
          `[NativeDelivery:uncovered-action-error] action=${action} chatroom=${event.chatroomId} role=${event.role} task=${task.taskId} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
        );
      });
    }, delayMs);
  }

  /**
   * Sends the single nudge for this (task, session). Commits to the ladder only after the
   * send succeeds.
   *
   * A nudge is never dropped: a busy delivery mutex is retried a bounded number of times,
   * and the terminal branch escalates through the ladder (restart, then park). The remaining
   * skip reasons mean the nudge target is not valid right now and each re-enters the ladder
   * on a guaranteed future event — a turn end (`turn_not_idle`), recovery completion
   * (`recovery_in_progress`, `slot_not_running`, session/pid change), or a new agent start
   * (`stop_requested`, `task_not_active`, `task_not_in_inbox`) — so they return.
   */
  private async sendUncoveredNudge(
    event: AgentTurnEndedEvent,
    task: { taskId: string },
    attempt = 0
  ): Promise<void> {
    const { chatroomId, role } = event;
    const sessionKey = sessionKeyFor(event.pid, event.slot.harnessSessionId);
    const deliveryState = getRoleDeliveryState();
    if (!deliveryState.tryAcquireDelivery(chatroomId, role)) {
      console.log(
        `[NativeDelivery:uncovered-nudge-skipped] chatroom=${chatroomId} role=${role} task=${task.taskId} reason=delivery_busy`
      );
      // Nothing is committed on a busy mutex, so retry the same step a bounded number of
      // times before escalating; otherwise the task stays active with no pending trigger.
      if (attempt + 1 < MAX_UNCOVERED_NUDGE_SEND_ATTEMPTS) {
        this.scheduleUncoveredAction(event, task, 'nudge', attempt + 1, UNCOVERED_NUDGE_RETRY_MS);
        return;
      }
      await this.escalateUndeliverableNudge(event, task, sessionKey);
      return;
    }
    const generation = deliveryState.getGeneration(chatroomId, role);
    try {
      const skipReason = this.uncoveredNudgeSkipReason(event, task);
      if (skipReason) {
        console.log(
          `[NativeDelivery:uncovered-nudge-skipped] chatroom=${chatroomId} role=${role} task=${task.taskId} reason=${skipReason}`
        );
        return;
      }
      try {
        await Effect.runPromise(
          this.deps.agentMgr.resumeTurnForSlot({
            chatroomId,
            role,
            prompt: buildUncoveredTurnNudgePrompt({ taskId: task.taskId }),
          })
        );
      } catch (error) {
        console.error(
          `[NativeDelivery:uncovered-nudge] chatroom=${chatroomId} role=${role} task=${task.taskId} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
        );
        await this.escalateUndeliverableNudge(event, task, sessionKey);
        return;
      }
      this.deps.taskService.confirmNudgeSent({ chatroomId, role, taskId: task.taskId, sessionKey });
    } finally {
      deliveryState.releaseDelivery(chatroomId, role, generation);
    }
  }

  /**
   * A nudge that could not be sent must not leave the task active with no pending trigger.
   * Escalates through the ladder: schedule the restart when the budget allows, otherwise run
   * the park action (the task service records redelivery_exhausted before it runs).
   */
  private async escalateUndeliverableNudge(
    event: AgentTurnEndedEvent,
    task: { taskId: string },
    sessionKey: string
  ): Promise<void> {
    const decision = await this.deps.taskService.decideUncoveredTurnEnd({
      chatroomId: event.chatroomId,
      role: event.role,
      taskId: task.taskId,
      sessionKey,
      nudgeUnavailable: true,
    });
    if (decision.action === 'restart-session') {
      this.scheduleUncoveredAction(event, task, 'restart-session');
    } else {
      this.applyParkAction(event);
    }
  }

  /**
   * Replaces the unanswered session with a fresh one, then lets the agent-started
   * reconcile redeliver the task. Composes the same public pieces as the user restart
   * path: prepare (closes the gate) → stop → recover (releases the task, reopens the gate)
   * → start. Runs out of band, never inside handleAgentTurnEnded. A failure is logged and
   * retried through the recovery gate. It never re-runs the ladder.
   */
  private async restartSessionForUncoveredTask(
    event: AgentTurnEndedEvent,
    task: { taskId: string }
  ): Promise<void> {
    const { chatroomId, role, pid } = event;
    const config = this.deps.configurationService.get(chatroomId, role);
    const slot = this.deps.agentMgr.getSlot(chatroomId, role);
    const harness = config?.agentHarness ?? slot?.harness;
    const model = config?.model ?? slot?.model;
    const workingDir = config?.workingDir ?? slot?.workingDir;
    if (!harness || !model || !workingDir) {
      console.error(
        `[NativeDelivery:uncovered-restart-failed] chatroom=${chatroomId} role=${role} task=${task.taskId} error=missing_agent_config`
      );
      // The restart budget is committed before this side effect, so the ladder cannot retry the
      // restart. Record the terminal step and park, instead of leaving the task active with no
      // pending restart (which the periodic reconcile cannot recover: it dedups an active task).
      const sessionKey = sessionKeyFor(event.pid, event.slot.harnessSessionId);
      await this.deps.taskService.decideUncoveredTurnEnd({
        chatroomId,
        role,
        taskId: task.taskId,
        sessionKey,
        nudgeUnavailable: true,
      });
      this.applyParkAction(event);
      return;
    }
    const startInput: EnsureAgentProcessInput = {
      chatroomId,
      role,
      agentHarness: harness as AgentHarness,
      model,
      workingDir,
      reason: DaemonStartReasonCode.RESPAWN,
      wantResume: false,
    };

    let outcome: RespawnStartOutcome;
    try {
      outcome = await this.deps.runSerializedForAgent(
        { chatroomId, role, workingDir },
        { timeoutMs: AGENT_LIFECYCLE_OPERATION_TIMEOUT_MS },
        async (ops, context): Promise<RespawnStartOutcome> => {
          const current = this.deps.agentMgr.getSlot(chatroomId, role);
          if (
            this.deps.agentMgr.isStopRequested(chatroomId, role) ||
            current?.pid !== pid ||
            current?.harnessSessionId !== event.slot.harnessSessionId
          ) {
            console.log(
              `[NativeDelivery:uncovered-restart-stale] chatroom=${chatroomId} role=${role} task=${task.taskId}`
            );
            return { kind: 'skipped', reason: 'stale_slot' };
          }
          await this.prepareRoleRecovery({ chatroomId, role });
          await ops.stopAgent(
            { chatroomId, role, reason: AgentStopReasonEnum['daemon.respawn'], pid, workingDir },
            context.signal
          );
          await this.recoverStoppedRole({ chatroomId, role, mode: 'automatic' });
          return this.attemptRespawnStart(ops, startInput, context.signal);
        }
      );
    } catch (error) {
      // Prepare, stop, or recover failed: the gate is still held, so retry the recovery.
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[NativeDelivery:uncovered-restart-failed] chatroom=${chatroomId} role=${role} task=${task.taskId} error=${message}`
      );
      if (this.recoveryGates.has(recoveryKey(chatroomId, role))) {
        this.scheduleRecoveryRetry(chatroomId, role);
      }
      return;
    }

    if (outcome.kind === 'start-failed') {
      console.error(
        `[NativeDelivery:uncovered-restart-failed] chatroom=${chatroomId} role=${role} task=${task.taskId} attempt=1 of ${MAX_RESPAWN_START_ATTEMPTS} error=${outcome.error}`
      );
      this.beginRespawnStartRetries({ chatroomId, role, workingDir, startInput });
    }
  }

  /** One start call inside a serialized section. Reports the result instead of throwing, so a failed start stays retryable. */
  private async attemptRespawnStart(
    ops: SerializedAgentOperations,
    startInput: EnsureAgentProcessInput,
    signal: AbortSignal
  ): Promise<RespawnStartOutcome> {
    try {
      const started = await ops.startAgent(startInput, signal);
      return started.success
        ? { kind: 'started' }
        : { kind: 'start-failed', error: started.error ?? 'start_rejected' };
    } catch (error) {
      return {
        kind: 'start-failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Records a failed respawn start and arms the first retry. The ladder is not re-run. */
  private beginRespawnStartRetries(request: RespawnStartRequest): void {
    if (this.disposed) return;
    const key = recoveryKey(request.chatroomId, request.role);
    this.cancelRespawnStart(key, 'superseded_by_new_restart');
    this.respawnRestartSeq += 1;
    const pending: PendingRespawnStart = {
      restartId: this.respawnRestartSeq,
      request,
      attempts: 1,
    };
    this.respawnStartRetries.set(key, pending);
    this.armRespawnStartRetry(key, pending);
  }

  private armRespawnStartRetry(key: string, pending: PendingRespawnStart): void {
    if (this.disposed) return;
    // Same backoff shape as scheduleRecoveryRetry: the first retry waits 1s.
    const delay = Math.min(30_000, 1_000 * 2 ** (pending.attempts - 1));
    pending.timer = setTimeout(() => {
      pending.timer = undefined;
      void this.retryRespawnStart(key, pending.restartId).catch((error: unknown) => {
        console.error(
          `[NativeDelivery:uncovered-restart-error] chatroom=${pending.request.chatroomId} role=${pending.request.role} error=${error instanceof Error ? (error.stack ?? error.message) : String(error)}`
        );
      });
    }, delay);
  }

  /** Retries only the start step. Re-checks that the same restart intent is still pending. */
  private async retryRespawnStart(key: string, restartId: number): Promise<void> {
    const pending = this.respawnStartRetries.get(key);
    if (!pending || pending.restartId !== restartId || this.disposed) return;
    const { chatroomId, role, workingDir, startInput } = pending.request;
    if (this.deps.agentMgr.isStopRequested(chatroomId, role)) {
      this.cancelRespawnStart(key, 'stop_requested');
      return;
    }
    const slot = this.deps.agentMgr.getSlot(chatroomId, role);
    if (slot && isSlotRunning(slot.state)) {
      this.cancelRespawnStart(key, 'agent_already_running');
      return;
    }

    const outcome = await this.deps.runSerializedForAgent(
      { chatroomId, role, workingDir },
      { timeoutMs: AGENT_LIFECYCLE_OPERATION_TIMEOUT_MS },
      async (ops, context): Promise<RespawnStartOutcome> => {
        // Re-check under the serialized section: the intent may have changed while queued.
        if (this.respawnStartRetries.get(key)?.restartId !== restartId) {
          return { kind: 'skipped', reason: 'superseded' };
        }
        if (this.deps.agentMgr.isStopRequested(chatroomId, role)) {
          return { kind: 'skipped', reason: 'stop_requested' };
        }
        const current = this.deps.agentMgr.getSlot(chatroomId, role);
        if (current && isSlotRunning(current.state)) {
          return { kind: 'skipped', reason: 'agent_already_running' };
        }
        return this.attemptRespawnStart(ops, startInput, context.signal);
      }
    );

    if (outcome.kind === 'skipped') {
      this.cancelRespawnStart(key, outcome.reason);
      return;
    }
    const current = this.respawnStartRetries.get(key);
    if (current?.restartId !== restartId) return;
    if (outcome.kind === 'started') {
      this.cancelRespawnStart(key, 'started');
      return;
    }
    current.attempts += 1;
    if (current.attempts >= MAX_RESPAWN_START_ATTEMPTS) {
      this.respawnStartRetries.delete(key);
      console.error(
        `[NativeDelivery:uncovered-restart-failed] attempts exhausted chatroom=${chatroomId} role=${role} attempts=${current.attempts} error=${outcome.error}`
      );
      return;
    }
    console.error(
      `[NativeDelivery:uncovered-restart-failed] chatroom=${chatroomId} role=${role} attempt=${current.attempts} of ${MAX_RESPAWN_START_ATTEMPTS} error=${outcome.error}`
    );
    this.armRespawnStartRetry(key, current);
  }

  /** Stops a pending respawn retry and logs why. A no-op when nothing is pending. */
  private cancelRespawnStart(key: string, reason: string): void {
    const pending = this.respawnStartRetries.get(key);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pending.timer = undefined;
    this.respawnStartRetries.delete(key);
    if (reason === 'started') return;
    console.log(
      `[NativeDelivery:uncovered-restart-cancelled] chatroom=${pending.request.chatroomId} role=${pending.request.role} attempts=${pending.attempts} reason=${reason}`
    );
  }

  /** Re-validates the nudge target under the delivery mutex. Returns the reason to skip, or undefined. */
  private uncoveredNudgeSkipReason(
    event: AgentTurnEndedEvent,
    task: { taskId: string }
  ): string | undefined {
    const { chatroomId, role } = event;
    const slot = this.deps.agentMgr.getSlot(chatroomId, role);
    if (!slot || !isSlotRunning(slot.state)) return 'slot_not_running';
    if (slot.pid !== event.pid) return 'pid_changed';
    if (slot.harnessSessionId !== event.slot.harnessSessionId) return 'session_changed';
    if (!isTurnPhaseIdle(slot.nativeTurnPhase ?? 'idle')) return 'turn_not_idle';
    if (this.deps.agentMgr.isStopRequested(chatroomId, role)) return 'stop_requested';
    if (this.recoveryGates.has(recoveryKey(chatroomId, role))) return 'recovery_in_progress';
    if (this.deps.agentTaskState.get({ chatroomId, role })?.taskId !== task.taskId) {
      return 'task_not_active';
    }
    const current = this.deps.taskInboxState.getForRole(chatroomId, role, task.taskId);
    if (!current || !(ACTIVE_TASK_STATUSES as readonly string[]).includes(current.status)) {
      return 'task_not_in_inbox';
    }
    return undefined;
  }

  /** Park action: clear the active task, then let the normal delivery decision run. */
  private applyParkAction(event: AgentTurnEndedEvent): void {
    this.deps.agentTaskState.clear({ chatroomId: event.chatroomId, role: event.role });
    this.scheduleRoleDelivery(event.chatroomId, event.role);
  }

  private scheduleRoleDelivery(chatroomId: string, role: string): void {
    setTimeout(() => {
      void this.requestReconcile({ chatroomId, role, source: 'turn-ended' }).catch(
        (error: unknown) => {
          console.warn(
            `[NativeDelivery] post-turn delivery failed for ${role}@${chatroomId}: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      );
    }, 0);
  }

  dispose(): void {
    this.disposed = true;
    for (const entry of this.turnFailureReleaseTimers.values()) {
      clearTimeout(entry.timer);
      this.deps.taskService.clearTurnFailureReleasePending(entry.key);
    }
    this.turnFailureReleaseTimers.clear();
    for (const pending of this.respawnStartRetries.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.timer = undefined;
    }
    this.respawnStartRetries.clear();
    for (const gate of this.recoveryGates.values()) {
      if (gate.retryTimer) clearTimeout(gate.retryTimer);
      gate.retryTimer = undefined;
      void gate.drainPromise.catch(() => undefined);
      void gate.recoveryPromise?.catch(() => undefined);
      gate.resolveCompletion();
    }
    this.recoveryGates.clear();
    this.unsubscribeAgentTurnEnded();
    this.unsubscribeAgentStarted();
    this.unsubscribeAgentSessionLost();
    this.unsubscribeAgentTurnProgress();
    this.unsubscribeTaskService?.();
    this.unsubscribeTaskService = undefined;
    this.nativeTaskDeliveryQueue.stop();
  }

  async disposeAndDrain(): Promise<void> {
    this.dispose();
    await this.nativeTaskDeliveryQueue.stopAndDrain();
  }

  get agentTaskState(): AgentTaskStateService {
    return this.deps.agentTaskState;
  }

  async handleTaskServiceNotification(
    notification: TaskServiceNotification
  ): Promise<TaskServiceDeliveryConfirmation | void> {
    if (notification.kind === 'bootstrap') {
      await this.requestReconcileForTasks(notification.tasks, 'bootstrap');
      return;
    }
    if (notification.kind === 'periodic-reconcile') {
      if (
        !this.canReconcileRole(notification.task.chatroomId, notification.task.agentConfig.role)
      ) {
        return;
      }
      const taskLookup = {
        chatroomId: notification.task.chatroomId,
        role: notification.task.agentConfig.role,
        taskId: notification.task.taskId,
      };
      const currentTask = await this.deliveryTaskService.loadAssignedTaskForAction(taskLookup);
      if (!currentTask) {
        this.deliveryTaskService.forgetStaleTask(taskLookup);
        console.warn(
          `[NativeDelivery:stale-task] chatroom=${taskLookup.chatroomId} role=${taskLookup.role} task=${taskLookup.taskId} reason=periodic_authoritative_task_missing`
        );
        return;
      }
      await this.requestReconcile({
        chatroomId: notification.task.chatroomId,
        role: notification.task.agentConfig.role,
        source: 'periodic-reconcile',
      });
      return;
    }
    if (notification.event.eventType === WorkspaceTaskInboxEventType.TaskDeleted) {
      // cancelTaskWork also clears the waiting backoff release and its marker.
      await this.cancelTaskWork(
        notification.event.chatroomId,
        notification.event.role,
        notification.event.taskId
      );
    }
    if (notification.event.eventType === WorkspaceTaskInboxEventType.TaskAssigned) {
      // Only the assigned task can be superseded. A waiting release for another
      // task of this role must still fire; its callback re-checks the task and
      // releases the superseded task.
      this.cancelTurnFailureRelease({
        chatroomId: notification.event.chatroomId,
        role: notification.event.role,
        taskId: notification.event.taskId,
      });
    }
    if (notification.event.task?.status === 'completed') {
      this.cancelTurnFailureRelease({
        chatroomId: notification.event.chatroomId,
        role: notification.event.role,
        taskId: notification.event.taskId,
      });
    }
    if (notification.event.eventType === WorkspaceTaskInboxEventType.TaskDeleted) {
      return { handledEventIds: [notification.event.eventId] };
    }
    const currentTask = this.deps.taskInboxState.getForRole(
      notification.event.chatroomId,
      notification.event.role,
      notification.event.taskId
    );
    if (
      !currentTask ||
      (currentTask.status !== 'pending' && currentTask.status !== 'acknowledged')
    ) {
      if (currentTask) {
        await this.clearExpectedTaskDeliveryFailure(currentTask.taskId);
      }
      return { handledEventIds: [notification.event.eventId] };
    }
    if (!this.canReconcileRole(notification.event.chatroomId, notification.event.role)) {
      return { handledEventIds: [notification.event.eventId] };
    }
    if (
      this.deps.agentTaskState.get({
        chatroomId: notification.event.chatroomId,
        role: notification.event.role,
      })?.taskId === notification.event.taskId
    ) {
      return { handledEventIds: [notification.event.eventId] };
    }
    const taskLookup = {
      chatroomId: notification.event.chatroomId,
      role: notification.event.role,
      taskId: notification.event.taskId,
    };
    const authoritativeTask = await this.deliveryTaskService.loadAssignedTaskForAction(taskLookup);
    if (!authoritativeTask) {
      this.deliveryTaskService.forgetStaleTask(taskLookup);
      console.warn(
        `[NativeDelivery:stale-task] chatroom=${taskLookup.chatroomId} role=${taskLookup.role} task=${taskLookup.taskId} reason=inbox_authoritative_task_missing`
      );
      return { handledEventIds: [notification.event.eventId] };
    }
    const deliveredTaskIds = await this.requestReconcile({
      chatroomId: notification.event.chatroomId,
      role: notification.event.role,
      source: 'inbox-event',
    });
    return { deliveredTaskIds };
  }

  private async clearExpectedTaskDeliveryFailure(taskId: string): Promise<void> {
    try {
      await this.deliveryTaskService.clearDeliveryFailure(taskId, 'task_not_deliverable');
    } catch (error) {
      console.warn(
        `[AgentWorkManager] failed to clear stale task delivery failure task=${taskId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async cancelTaskWork(chatroomId: string, role: string, taskId: string): Promise<void> {
    this.cancelTurnFailureRelease({ chatroomId, role, taskId });
    const activeTask = this.deps.agentTaskState.get({ chatroomId, role });
    if (activeTask?.taskId !== taskId) return;

    this.deps.agentTaskState.clear({ chatroomId, role });
    const slot = this.deps.agentMgr.getSlot(chatroomId, role);
    if (!slot || slot.state === AGENT_SLOT_STATE.IDLE || slot.state === AGENT_SLOT_STATE.STOPPING)
      return;

    try {
      await this.deps.runSerializedForAgent(
        { chatroomId, role },
        { timeoutMs: 120_000 },
        (ops, context) =>
          ops.stopAgent(
            {
              chatroomId,
              role,
              reason: AgentStopReasonEnum['platform.task_cancelled'],
              ...(slot.pid === undefined ? {} : { pid: slot.pid }),
            },
            context.signal
          )
      );
    } catch (error) {
      console.warn(
        `[AgentWorkManager] task cancellation stop failed for ${role}@${chatroomId} task=${taskId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async requestReconcile(params: {
    chatroomId: string;
    role: string;
    source: AgentWorkPass;
    onTaskDelivered?: AgentTaskDeliveredHandler;
  }): Promise<readonly string[]> {
    if (this.disposed || !this.canReconcileRole(params.chatroomId, params.role)) return [];
    const key = `${params.chatroomId}:${params.role.toLowerCase()}`;
    const existing = this.reconcileStates.get(key);
    if (existing) {
      existing.pendingSource = params.source;
      return existing.promise;
    }

    const state: {
      pendingSource: AgentWorkPass | undefined;
      promise: Promise<readonly string[]>;
    } = {
      pendingSource: undefined,
      promise: Promise.resolve([]),
    };
    // fallow-ignore-next-line complexity
    state.promise = (async () => {
      const delivered: string[] = [];
      try {
        do {
          if (this.disposed || !this.canReconcileRole(params.chatroomId, params.role)) {
            return delivered;
          }
          const source = state.pendingSource ?? params.source;
          state.pendingSource = undefined;
          await this.waitForRoleRecovery(params.chatroomId, params.role);
          if (this.disposed || !this.canReconcileRole(params.chatroomId, params.role)) {
            return delivered;
          }
          const generation = getRoleDeliveryState().getGeneration(params.chatroomId, params.role);
          const isCurrent = () =>
            this.canReconcileRole(params.chatroomId, params.role) &&
            !this.recoveryGates.has(key) &&
            getRoleDeliveryState().getGeneration(params.chatroomId, params.role) === generation;
          const tasks = this.deps.taskInboxState.listForRole(params.chatroomId, params.role);
          delivered.push(
            ...(await this.reconcileRole(source, tasks, params.onTaskDelivered, isCurrent))
          );
        } while (state.pendingSource !== undefined);
      } finally {
        if (this.reconcileStates.get(key) === state) this.reconcileStates.delete(key);
      }
      return delivered;
    })();
    this.reconcileStates.set(key, state);
    return state.promise;
  }

  // fallow-ignore-next-line unused-class-member
  async reconcileAfterAgentRestart(args: { chatroomId: string; role: string }): Promise<string[]> {
    const delivered: string[] = [];
    await this.requestReconcile({
      chatroomId: args.chatroomId,
      role: args.role,
      source: 'restart-completed',
      onTaskDelivered: ({ taskId }) => {
        delivered.push(taskId);
      },
    });
    return delivered;
  }

  private async requestReconcileForTasks(
    tasks: readonly AssignedTask[],
    source: AgentWorkPass
  ): Promise<void> {
    const roles = new Set(
      tasks.map((snapshot) => `${snapshot.chatroomId}:${snapshot.agentConfig.role.toLowerCase()}`)
    );
    await Promise.all(
      [...roles].map((key) => {
        const separator = key.indexOf(':');
        return this.requestReconcile({
          chatroomId: key.slice(0, separator),
          role: key.slice(separator + 1),
          source,
        });
      })
    );
  }

  private async reconcileRole(
    pass: AgentWorkPass,
    tasks: readonly AssignedTask[],
    onTaskDelivered?: AgentTaskDeliveredHandler,
    isCurrent: () => boolean = () => true
  ): Promise<readonly string[]> {
    if (tasks.length === 0) return [];
    return processTasksUpdate(
      this.deliveryTaskService,
      this.deps.configurationService,
      pass,
      ({ chatroomId, role, taskId }) =>
        this.deps.agentTaskState.get({ chatroomId, role })?.taskId === taskId,
      {
        tasks,
        isCurrent,
        onTaskDeliveryStarted: (args) => this.recordTaskDeliveryStarted(args),
        onTaskDeliveryFailed: (args) => this.recordTaskDeliveryFailed(args),
        onTaskDelivered: (args) => {
          this.recordTaskDelivered(args);
          onTaskDelivered?.(args);
        },
      },
      this.deps.acquireNativeDeliverySlot
    );
  }

  recordTaskDeliveryStarted(args: TaskDeliveryLifecycleArgs): void {
    this.deps.agentTaskState.start(args);
  }

  recordTaskDeliveryFailed(args: { chatroomId: string; role: string; taskId: string }): void {
    const key = { chatroomId: args.chatroomId, role: args.role };
    if (this.deps.agentTaskState.get(key)?.taskId === args.taskId) {
      this.deps.agentTaskState.clear(key);
    }
  }

  recordTaskDelivered(args: { chatroomId: string; role: string; taskId: string }): void {
    this.deps.agentTaskState.start(args);
  }
}
