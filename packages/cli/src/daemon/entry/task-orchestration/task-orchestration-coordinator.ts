/**
 * Canonical task orchestration coordinator.
 *
 * Unifies pending-task delivery sequencing behind one daemon-scoped,
 * dependency-injected instance:
 *
 * - Exactly one public orchestration API: `accept(event)` + `stop()`.
 * - Per-role coalescing drains: at most one active drain per role. Events that
 *   arrive during a pass set dirty state and are covered by exactly one
 *   trailing pass, so no event is lost. Different roles drain concurrently.
 * - `turn-idle` is immediate/high-priority (primary delivery logging);
 *   `periodic-reconcile` remains a safety net, not a time-based debounce.
 * - AgentProcessManager stays authoritative for process and slot lifecycle.
 *   This coordinator never owns slots, PIDs, spawning, stopping, or native
 *   turn-phase mutation — it only calls the narrow process port below.
 *
 * Constraints (ported from the legacy processor/coordinator, do not remove):
 * - restart suppression, stale-turn correction, task status/assignment checks,
 *   native harness + nativeTurnPhase readiness gates, cold-session policy,
 *   full action hydration, claim/resume/inject behavior,
 *   lifecycle outbox requirement, NativeDeliveryLedger, RoleDeliveryState,
 *   last-in-flight tracking, finalizer release, one injection at a time/role.
 *
 * Transitional fallow suppressions (remove after migration/removal slices):
 * - unused-file: production callers still use the legacy processor/coordinator;
 *   wiring the canonical coordinator happens in the migration slice.
 * - code-duplication: recovery/delivery sequencing intentionally mirrors the
 *   legacy files until they are deleted in the removal slice.
 */
// fallow-ignore-file complexity code-duplication unused-file

import type { ChatroomRole } from '@workspace/shared/domain/chatroom-role';
import { Effect, Runtime, type Context } from 'effect';

import { api } from '../../../api.js';
import { mapAssignedTaskView } from '../../../infrastructure/mappers/map-assigned-task.js';
import { getErrorMessage } from '../../../utils/convex-error.js';
import type { AgentLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../../domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../domain/entities/assigned-task.js';
import type { AgentOperationalReadModel } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import { enrichSnapshotsWithOperational } from '../../infrastructure/agent-operational/enrich-snapshot-with-operational.js';
import type { OperationalInboxUpdate } from '../../infrastructure/agent-operational/operational-inbox.js';
import type {
  AgentSlot,
  EnsureRunningOpts,
  OperationResult,
  StopOpts,
} from '../../infrastructure/agent-process-manager/agent-process-manager.js';
import type { AgentProcessManagerService } from '../../infrastructure/agent-process-manager/service/index.js';
import type { MachineTaskSnapshotState } from '../../infrastructure/inbox/task-snapshot-state.js';
import type { TaskInboxUpdate } from '../../infrastructure/inbox/task.js';
import type { DaemonAgentProcessManagerService, DaemonSessionService } from '../daemon-services.js';
import {
  getNativeDeliveryLedger,
  type NativeDeliveryLedger,
} from '../native-delivery/native-delivery-ledger.js';
import {
  logNativeDeliveryFallback,
  logNativeDeliveryInjecting,
  logNativeDeliveryMutexSkip,
  logNativeDeliveryPrimary,
  logNativeDeliverySkip,
} from '../native-delivery/native-delivery-log.js';
import {
  explainLedgerDeliveryBlock,
  explainNativeDeliveryBlock,
} from '../native-delivery/native-task-injector-logic.js';
import {
  runNativeInjectionEffect,
  type NativeDeliverySessionHandles,
  type NativeInjectorAgentMgr,
} from '../native-delivery/native-task-injector.js';
import {
  filterSnapshotsExcludingRestartInFlight,
  isRestartOrchestratorInFlight,
} from '../restart-orchestrator-in-flight.js';
import { getRoleDeliveryState } from '../role-delivery-state.js';

export type TaskOrchestrationEvent =
  | { type: 'bootstrap'; snapshots: readonly AssignedTaskSnapshotView[] }
  | { type: 'task-signal'; update: TaskInboxUpdate }
  | { type: 'operational-signal'; update: OperationalInboxUpdate }
  | { type: 'periodic-reconcile' }
  | { type: 'turn-idle'; chatroomId: string; role: string }
  | { type: 'agent-started'; chatroomId: string; role: string }
  | { type: 'session-lost'; chatroomId: string; role: string; harnessSessionId?: string }
  | { type: 'restart-reset'; chatroomId: string; role: string };

export interface TaskOrchestrationProcessPort {
  getSlot(chatroomId: string, role: string): AgentSlot | undefined;
  clearStuckStoppingSlot(
    chatroomId: string,
    role: string,
    options: { clearStopIntent: boolean }
  ): Promise<boolean>;
  ensureRunning(opts: EnsureRunningOpts): Effect.Effect<OperationResult>;
  stop(opts: StopOpts): Effect.Effect<{ success: boolean }>;
  resumeTurnForSlot(args: {
    chatroomId: string;
    role: string;
    prompt: string;
  }): Effect.Effect<void>;
}

export interface TaskOrchestrationSessionDeps extends NativeDeliverySessionHandles {
  convexUrl: string;
}

export interface TaskOrchestrationCoordinatorDeps {
  runtime: Runtime.Runtime<DaemonSessionService | DaemonAgentProcessManagerService>;
  effectContext: Context.Context<DaemonSessionService | DaemonAgentProcessManagerService>;
  sessionDeps: TaskOrchestrationSessionDeps;
  process: TaskOrchestrationProcessPort;
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
  taskSnapshotState: MachineTaskSnapshotState;
  agentOperationalReadModel: AgentOperationalReadModel;
  lifecycleOutbox?: { enqueue: (fact: AgentLifecycleFact) => Promise<unknown> };
}

export interface TaskOrchestrationCoordinator {
  accept(event: TaskOrchestrationEvent): Promise<void>;
  stop(): Promise<void>;
}

type PassReason =
  | 'bootstrap'
  | 'inbox-signal'
  | 'operational-status'
  | 'periodic-reconcile'
  | 'turn-idle'
  | 'agent-started';

interface RoleDrainState {
  chatroomId: string;
  role: string;
  running: boolean;
  dirty: boolean;
  reasons: Set<PassReason>;
  waiters: (() => void)[];
  activeDrain: Promise<void> | null;
}

/** Collision-safe per-role key: chatroom + case-insensitive role. */
function roleKey(chatroomId: string, role: string): string {
  return JSON.stringify([chatroomId, role.toLowerCase()]);
}

export function createTaskOrchestrationCoordinator(
  deps: TaskOrchestrationCoordinatorDeps
): TaskOrchestrationCoordinator {
  const drains = new Map<string, RoleDrainState>();
  const ledger: NativeDeliveryLedger = getNativeDeliveryLedger();
  const deliveryState = getRoleDeliveryState();
  let stopped = false;

  function runPort<A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> {
    const provided = Effect.provide(
      effect as Effect.Effect<A, unknown, never>,
      deps.effectContext as Context.Context<never>
    );
    return Runtime.runPromise(deps.runtime as Runtime.Runtime<never>)(provided);
  }

  function getOrCreateDrain(chatroomId: string, role: string): RoleDrainState {
    const key = roleKey(chatroomId, role);
    let state = drains.get(key);
    if (!state) {
      state = {
        chatroomId,
        role,
        running: false,
        dirty: false,
        reasons: new Set(),
        waiters: [],
        activeDrain: null,
      };
      drains.set(key, state);
    }
    return state;
  }

  function scheduleRole(chatroomId: string, role: string, reason: PassReason): Promise<void> {
    // stop() ignores (resolves) new events instead of enqueueing work.
    if (stopped) return Promise.resolve();
    const state = getOrCreateDrain(chatroomId, role);
    return new Promise<void>((resolve) => {
      state.waiters.push(resolve);
      state.reasons.add(reason);
      if (state.running) {
        // Covered by exactly one trailing pass — no event is lost.
        state.dirty = true;
        return;
      }
      state.running = true;
      state.activeDrain = runDrainLoop(state);
    });
  }

  async function runDrainLoop(state: RoleDrainState): Promise<void> {
    try {
      for (;;) {
        const reasons = new Set(state.reasons);
        state.reasons.clear();
        state.dirty = false;
        const waiters = state.waiters.splice(0, state.waiters.length);
        try {
          await reconcileRole(state.chatroomId, state.role, reasons);
        } catch (err) {
          // A failed pass releases scheduler state and permits a later retry.
          console.warn(
            `[TaskOrchestration] drain failed for ${state.role}@${state.chatroomId}: ${getErrorMessage(err)}`
          );
        } finally {
          for (const resolve of waiters) resolve();
        }
        if (!state.dirty || stopped) break;
      }
    } finally {
      state.running = false;
      state.activeDrain = null;
      // Settle any waiters that arrived after the loop exited (e.g. on stop).
      const leftover = state.waiters.splice(0, state.waiters.length);
      for (const resolve of leftover) resolve();
    }
  }

  async function fetchTaskForAction(
    row: AssignedTaskSnapshotView
  ): Promise<AssignedTaskWithContent | null> {
    const result = await deps.sessionDeps.backend.query(api.machines.getAssignedTaskForAction, {
      sessionId: deps.sessionDeps.sessionId,
      machineId: deps.sessionDeps.machineId,
      taskId: row.taskId,
      role: row.agentConfig.role,
    });
    return result ? mapAssignedTaskView(result as Parameters<typeof mapAssignedTaskView>[0]) : null;
  }

  function buildInjectorAgentMgr(): NativeInjectorAgentMgr {
    return {
      resumeTurnForSlot: (args) => runPort(deps.process.resumeTurnForSlot(args)),
      getSlot: (chatroomId, role) => deps.process.getSlot(chatroomId, role),
    };
  }

  // fallow-ignore-next-line complexity
  async function deliverNativeForRole(tasks: AssignedTaskSnapshotView[]): Promise<void> {
    const pendingFirst = [...tasks].sort((a, b) => {
      if (a.status === 'pending' && b.status !== 'pending') return -1;
      if (b.status === 'pending' && a.status !== 'pending') return 1;
      return a.createdAt - b.createdAt;
    });

    for (const row of pendingFirst) {
      const roleName = row.agentConfig.role;
      const slot = deps.process.getSlot(row.chatroomId, roleName);
      const operational = deps.agentOperationalReadModel.get(row.chatroomId, roleName);
      const blockReason = explainNativeDeliveryBlock(row, { slot, operational });
      if (blockReason) {
        if (isDeliverableTaskStatus(row.status)) {
          logNativeDeliverySkip(roleName, row.chatroomId, row.taskId, blockReason);
        }
        continue;
      }

      // Absent harness id is represented as absent (never a pretend
      // session). Cold policy creates a real session inside the injector;
      // continue policy without a session fails before receipt/injection.
      const harnessSessionId = slot?.harnessSessionId;

      const ledgerBlock = explainLedgerDeliveryBlock(row.taskId, harnessSessionId, ledger);
      if (ledgerBlock) {
        logNativeDeliverySkip(roleName, row.chatroomId, row.taskId, ledgerBlock);
        continue;
      }
      if (!ledger.tryAcquire(row.taskId, harnessSessionId)) {
        logNativeDeliverySkip(
          roleName,
          row.chatroomId,
          row.taskId,
          'delivery_ledger_busy (duplicate inject in flight)'
        );
        continue;
      }

      if (!deliveryState.tryAcquireDelivery(row.chatroomId, roleName)) {
        ledger.releaseAttempt(row.taskId);
        logNativeDeliveryMutexSkip(roleName, row.chatroomId, row.taskId);
        continue;
      }

      logNativeDeliveryInjecting(roleName, row.chatroomId, row.taskId);

      const taskId = row.taskId;
      let deliveredToHarness = false;
      // Container object so the callback assignment is visible to narrowing.
      const deliveryResult: {
        args: {
          chatroomId: string;
          role: string;
          taskId: string;
          harnessSessionId: string;
        } | null;
      } = { args: null };
      try {
        const full = await fetchTaskForAction(row);
        if (!full) {
          console.warn(
            `[NativeDelivery:skip] ${roleName}@${row.chatroomId} task ${row.taskId} — task_hydrate_missing (deleted or not assigned)`
          );
        } else if (!deps.lifecycleOutbox) {
          // Lifecycle outbox is required before any receipt/injection.
          console.warn(
            `[NativeDelivery:skip] ${roleName}@${row.chatroomId} task ${row.taskId} — lifecycle_outbox_missing`
          );
        } else {
          await runPort(
            runNativeInjectionEffect(full, harnessSessionId, {
              sessionId: deps.sessionDeps.sessionId,
              machineId: deps.sessionDeps.machineId,
              logEvent: deps.sessionDeps.logEvent,
              backend: deps.sessionDeps.backend,
              lifecycleOutbox: deps.lifecycleOutbox,
              agentMgr: buildInjectorAgentMgr(),
              runSerializedForAgent: deps.runSerializedForAgent,
              convexUrl: deps.sessionDeps.convexUrl,
              onTaskDelivered: (args) => {
                deliveredToHarness = true;
                deliveryResult.args = args;
              },
            })
          );
          const delivered = deliveryResult.args;
          if (delivered) {
            ledger.markDelivered(delivered.taskId, delivered.harnessSessionId);
            deliveryState.clearNativeNudgeFailures(delivered.chatroomId, delivered.role);
          }
        }
      } catch (err) {
        console.warn(
          `[NativeTaskDelivery] delivery failed for ${roleName}@${row.chatroomId}: ${getErrorMessage(err)}`
        );
      } finally {
        deliveryState.releaseDelivery(row.chatroomId, roleName);
        // Finalizer always releases the attempt, including success
        // (markDelivered already released), missing hydrate/outbox,
        // claim/start/prompt failure, and interruption.
        if (!deliveredToHarness) {
          ledger.releaseAttempt(taskId);
        }
      }
      // Serial native delivery per role — one task at a time.
      break;
    }
  }

  async function reconcileRole(
    chatroomId: string,
    role: string,
    reasons: ReadonlySet<PassReason>
  ): Promise<void> {
    // Restart-in-flight roles are fully suppressed for this pass.
    if (isRestartOrchestratorInFlight(chatroomId, role)) return;
    const snapshots = deps.taskSnapshotState.listForRole(chatroomId, role as ChatroomRole);
    const enriched = enrichSnapshotsWithOperational(snapshots, deps.agentOperationalReadModel);
    // Restart suppression is applied once per pass before ownership selection.
    const tasks = filterSnapshotsExcludingRestartInFlight(enriched);
    if (tasks.length === 0) return;

    // Exactly one trigger line per pass: turn-idle wins primary logging,
    // otherwise one deterministic fallback reason.
    if (reasons.has('turn-idle')) {
      logNativeDeliveryPrimary(role, chatroomId);
    } else {
      const fallback = [...reasons].filter((reason) => reason !== 'turn-idle').sort()[0];
      if (fallback) {
        logNativeDeliveryFallback(fallback, role, chatroomId, tasks[0]?.taskId);
      }
    }

    // Normalize one expired stopping slot per role/pass so cold delivery
    // decisions and recovery suppression observe the same lifecycle.
    const first = tasks[0];
    if (first) {
      try {
        const cleared = await deps.process.clearStuckStoppingSlot(chatroomId, role, {
          clearStopIntent: first.agentConfig.desiredState === 'running',
        });
        if (cleared) {
          console.log(`[TaskRecovery] cleared stuck stopping slot for ${role}@${chatroomId}`);
        }
      } catch (err) {
        console.warn(
          `[TaskRecovery] clear stuck stopping slot failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`
        );
      }
    }

    await deliverNativeForRole(tasks);
  }

  function uniqueRoles(
    rows: readonly AssignedTaskSnapshotView[]
  ): { chatroomId: string; role: string }[] {
    const seen = new Set<string>();
    const out: { chatroomId: string; role: string }[] = [];
    for (const row of rows) {
      const key = roleKey(row.chatroomId, row.agentConfig.role);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ chatroomId: row.chatroomId, role: row.agentConfig.role });
    }
    return out;
  }

  return {
    // fallow-ignore-next-line complexity
    async accept(event: TaskOrchestrationEvent): Promise<void> {
      switch (event.type) {
        case 'bootstrap': {
          deps.taskSnapshotState.replace([...event.snapshots]);
          await Promise.all(
            uniqueRoles(event.snapshots).map(({ chatroomId, role }) =>
              scheduleRole(chatroomId, role, 'bootstrap')
            )
          );
          return;
        }
        case 'task-signal': {
          const { update } = event;
          deps.taskSnapshotState.applySignalPage(update.signals, update.snapshots);
          // Schedule roles from both signals and snapshots so removed/missing
          // snapshots (completed, deleted, reassigned) still reconcile.
          const byKey = new Map<string, { chatroomId: string; role: string }>();
          for (const signal of update.signals) {
            const key = roleKey(signal.chatroomId, signal.targetRole);
            if (!byKey.has(key)) {
              byKey.set(key, { chatroomId: signal.chatroomId, role: signal.targetRole });
            }
          }
          for (const { chatroomId, role } of uniqueRoles(update.snapshots)) {
            const key = roleKey(chatroomId, role);
            if (!byKey.has(key)) byKey.set(key, { chatroomId, role });
          }
          await Promise.all(
            [...byKey.values()].map(({ chatroomId, role }) =>
              scheduleRole(chatroomId, role, 'inbox-signal')
            )
          );
          return;
        }
        case 'operational-signal': {
          const { update } = event;
          const changed = deps.agentOperationalReadModel.applySignalPage(
            update.rows,
            update.removed
          );
          await Promise.all(
            changed.map(({ chatroomId, role }) =>
              scheduleRole(chatroomId, role, 'operational-status')
            )
          );
          return;
        }
        case 'periodic-reconcile': {
          await Promise.all(
            uniqueRoles(deps.taskSnapshotState.listAll()).map(({ chatroomId, role }) =>
              scheduleRole(chatroomId, role, 'periodic-reconcile')
            )
          );
          return;
        }
        case 'turn-idle': {
          await scheduleRole(event.chatroomId, event.role, 'turn-idle');
          return;
        }
        case 'agent-started': {
          await scheduleRole(event.chatroomId, event.role, 'agent-started');
          return;
        }
        case 'session-lost': {
          // Synchronous reset — never enqueues ordinary delivery work.
          deliveryState.resetDeliveryState(event.chatroomId, event.role);
          if (event.harnessSessionId) {
            ledger.clearSession(event.harnessSessionId);
          }
          return;
        }
        case 'restart-reset': {
          // Synchronous reset — never enqueues ordinary delivery work.
          deliveryState.resetDeliveryState(event.chatroomId, event.role);
          return;
        }
      }
    },

    async stop(): Promise<void> {
      stopped = true;
      const active = [...drains.values()]
        .map((state) => state.activeDrain)
        .filter((drain): drain is Promise<void> => drain !== null);
      await Promise.all(active);
    },
  };
}
