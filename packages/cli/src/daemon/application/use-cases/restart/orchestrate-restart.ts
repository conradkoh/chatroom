/**
 * Orchestrates atomic user restart: reset → spawn → await session → ready → deliver pending.
 * P4: when DAEMON_ORCHESTRATION_P4 is enabled, restart phase/completed facts are emitted as
 * local lifecycle events and projected to Convex via the outbox; otherwise direct mutations.
 */

// fallow-ignore-file coverage-gaps complexity
import type { DatabaseSync } from 'node:sqlite';

import { HARNESS_SESSION_READY_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import type { AgentRestartPhase } from '@workspace/backend/src/domain/usecase/agent/build-agent-restart-event.js';
import { parseAssignedTaskMonitorRows } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';
import { Effect } from 'effect';

import { api } from '../../../../api.js';
import {
  mapAssignedTaskSnapshotList,
  mapAssignedTaskView,
} from '../../../../infrastructure/mappers/map-assigned-task.js';
import { getErrorMessage } from '../../../../utils/convex-error.js';
import { isDeliverableTaskStatus } from '../../../domain/entities/assigned-task.js';
import type { AssignedTaskSnapshotView } from '../../../domain/entities/assigned-task.js';
import { isTeamAgentRole } from '../../../domain/entities/execution-kind.js';
import {
  buildRestartCompletedEvent,
  buildRestartPhaseEvent,
} from '../../../domain/events/agent-lifecycle.js';
import type { DaemonAgentProcessManagerServiceShape } from '../../../entry/daemon-services.js';
import type { AgentHarness } from '../../../entry/daemon-types.js';
import { getNativeDeliveryLedger } from '../../../entry/native-delivery/native-delivery-ledger.js';
import { isAgentReadyForNativeDelivery } from '../../../entry/native-delivery/native-ready-invariant.js';
import { resetRoleDeliveryState } from '../../../entry/native-delivery/native-task-delivery-coordinator.js';
import { explainLedgerDeliveryBlock } from '../../../entry/native-delivery/native-task-injector-logic.js';
import { runNativeInjectionEffect } from '../../../entry/native-delivery/native-task-injector.js';
import {
  markRestartOrchestratorInFlight,
  clearRestartOrchestratorInFlight,
} from '../../../entry/restart-orchestrator-in-flight.js';
import { listSnapshotViewsFromReadModels } from '../../../infrastructure/persistence/read-models/task-snapshot-adapter.js';
import {
  isDaemonOrchestrationP4Enabled,
  isDaemonOrchestrationP2CutoverEnabled,
} from '../../../infrastructure/projection/feature-flags.js';
import type { AgentLifecyclePort } from '../../ports/agent-lifecycle.port.js';

interface RestartOrchestratorEvent {
  chatroomId: string;
  role: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  correlationId: string;
  wantResume?: boolean;
}

export interface RestartOrchestratorSession {
  sessionId: string;
  machineId: string;
  convexUrl: string;
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
}

interface OrchestrateRestartDeps {
  session: RestartOrchestratorSession;
  agentMgr: DaemonAgentProcessManagerServiceShape;
  /** P4: local lifecycle port used for restart phase/completed events when enabled. */
  lifecycle?: AgentLifecyclePort;
}

let restartOrchestratorDb: DatabaseSync | undefined;

/** Set the SQLite handle used for P2 cutover reads (set by start-daemon when P2_CUTOVER enabled). */
export function setRestartOrchestratorDb(db: DatabaseSync | undefined): void {
  restartOrchestratorDb = db;
}

async function emitPhase(
  deps: OrchestrateRestartDeps,
  event: RestartOrchestratorEvent,
  phase: AgentRestartPhase | 'completed' | 'failed',
  detail?: string
): Promise<void> {
  if (isDaemonOrchestrationP4Enabled()) {
    if (!deps.lifecycle) {
      throw new Error('AgentLifecyclePort required when DAEMON_ORCHESTRATION_P4 is enabled');
    }
    deps.lifecycle.appendLifecycleEvent(
      buildRestartPhaseEvent({
        chatroomId: event.chatroomId,
        role: event.role,
        machineId: deps.session.machineId,
        correlationId: event.correlationId,
        phase,
        detail,
        timestamp: Date.now(),
      })
    );
    return;
  }
  await deps.session.backend.mutation(api.machines.emitRestartPhase, {
    sessionId: deps.session.sessionId,
    machineId: deps.session.machineId,
    chatroomId: event.chatroomId,
    role: event.role,
    correlationId: event.correlationId,
    phase,
    detail,
  });
}

async function emitRestartCompleted(
  deps: OrchestrateRestartDeps,
  event: RestartOrchestratorEvent,
  deliveredTaskIds: string[]
): Promise<void> {
  if (isDaemonOrchestrationP4Enabled()) {
    if (!deps.lifecycle) {
      throw new Error('AgentLifecyclePort required when DAEMON_ORCHESTRATION_P4 is enabled');
    }
    deps.lifecycle.appendLifecycleEvent(
      buildRestartCompletedEvent({
        chatroomId: event.chatroomId,
        role: event.role,
        machineId: deps.session.machineId,
        correlationId: event.correlationId,
        deliveredTaskIds,
        timestamp: Date.now(),
      })
    );
    return;
  }
  await deps.session.backend.mutation(api.machines.emitRestartCompleted, {
    sessionId: deps.session.sessionId,
    machineId: deps.session.machineId,
    chatroomId: event.chatroomId,
    role: event.role,
    correlationId: event.correlationId,
    deliveredTaskIds,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHarnessSessionId(
  deps: OrchestrateRestartDeps,
  event: RestartOrchestratorEvent,
  pid: number
): Promise<string | null> {
  const initial = deps.agentMgr.getSlot(event.chatroomId, event.role);
  if (initial?.harnessSessionId) {
    return initial.harnessSessionId;
  }

  const deadline = Date.now() + HARNESS_SESSION_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const slot = deps.agentMgr.getSlot(event.chatroomId, event.role);
    if (slot?.harnessSessionId) {
      return slot.harnessSessionId;
    }
    await sleep(100);
  }

  await deps.agentMgr.stop({
    chatroomId: event.chatroomId,
    role: event.role,
    reason: 'user.restart',
    pid,
  });

  return null;
}

async function forceNativeWaiting(
  deps: OrchestrateRestartDeps,
  event: RestartOrchestratorEvent
): Promise<void> {
  if (!isTeamAgentRole(event.role)) return;
  await deps.session.backend.mutation(api.participants.join, {
    sessionId: deps.session.sessionId,
    chatroomId: event.chatroomId,
    role: event.role,
    action: NATIVE_WAITING_ACTION,
  });
}

async function listDeliverableSnapshots(
  deps: OrchestrateRestartDeps,
  event: RestartOrchestratorEvent
): Promise<AssignedTaskSnapshotView[]> {
  const slot = deps.agentMgr.getSlot(event.chatroomId, event.role);

  let candidates: AssignedTaskSnapshotView[];
  if (restartOrchestratorDb && isDaemonOrchestrationP2CutoverEnabled()) {
    candidates = listSnapshotViewsFromReadModels(restartOrchestratorDb, deps.session.machineId);
  } else {
    await deps.session.backend.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
      sessionId: deps.session.sessionId,
      machineId: deps.session.machineId,
    });
    const result = (await deps.session.backend.query(
      api.machines.listMachineAssignedTaskSnapshots,
      {
        sessionId: deps.session.sessionId,
        machineId: deps.session.machineId,
      }
    )) as { tasks?: unknown };
    candidates = mapAssignedTaskSnapshotList(parseAssignedTaskMonitorRows(result.tasks ?? []));
  }

  return candidates
    .filter(
      (t) =>
        t.chatroomId === event.chatroomId &&
        t.agentConfig.role.toLowerCase() === event.role.toLowerCase() &&
        isDeliverableTaskStatus(t.status) &&
        isAgentReadyForNativeDelivery(t, slot)
    )
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function deliverOneTask(
  deps: OrchestrateRestartDeps,
  event: RestartOrchestratorEvent,
  snapshot: AssignedTaskSnapshotView
): Promise<boolean> {
  const slot = deps.agentMgr.getSlot(event.chatroomId, event.role);
  const harnessSessionId = slot?.harnessSessionId;
  if (!harnessSessionId) return false;

  const backend = (await deps.session.backend.query(api.machines.getAssignedTaskForAction, {
    sessionId: deps.session.sessionId,
    machineId: deps.session.machineId,
    taskId: snapshot.taskId,
    role: event.role,
  })) as Parameters<typeof mapAssignedTaskView>[0] | null;

  if (!backend) return false;

  const full = mapAssignedTaskView(backend);

  const ledger = getNativeDeliveryLedger();
  const ledgerBlock = explainLedgerDeliveryBlock(
    snapshot.taskId as string,
    harnessSessionId,
    ledger
  );
  if (ledgerBlock) {
    console.warn(`[RestartOrchestrator] skip task ${snapshot.taskId} — ${ledgerBlock}`);
    return false;
  }
  if (!ledger.tryAcquire(snapshot.taskId as string, harnessSessionId)) {
    console.warn(`[RestartOrchestrator] skip task ${snapshot.taskId} — delivery_ledger_busy`);
    return false;
  }

  let deliveredToHarness = false;
  try {
    await Effect.runPromise(
      runNativeInjectionEffect(full, harnessSessionId, {
        sessionId: deps.session.sessionId,
        machineId: deps.session.machineId,
        backend: deps.session.backend,
        convexUrl: deps.session.convexUrl,
        agentMgr: {
          resumeTurnForSlot: async (args) => {
            await Effect.runPromise(deps.agentMgr.resumeTurnForSlot(args));
          },
        },
        onTaskDelivered: ({ chatroomId, role, taskId }) => {
          deliveredToHarness = true;
          ledger.markDelivered(taskId, harnessSessionId);
          void deps.agentMgr.setLastInFlightTask(chatroomId, role, taskId);
        },
      })
    );
    return true;
  } catch (err) {
    console.warn(
      `[RestartOrchestrator] deliver failed for task ${snapshot.taskId}: ${getErrorMessage(err)}`
    );
    return false;
  } finally {
    if (!deliveredToHarness) {
      ledger.clearDelivery(snapshot.taskId as string, harnessSessionId);
    }
  }
}

async function deliverPendingTasks(
  deps: OrchestrateRestartDeps,
  event: RestartOrchestratorEvent
): Promise<string[]> {
  const delivered: string[] = [];
  const snapshots = await listDeliverableSnapshots(deps, event);

  for (const snapshot of snapshots) {
    if (snapshot.status !== 'pending') continue;
    const ok = await deliverOneTask(deps, event, snapshot);
    if (ok) {
      delivered.push(snapshot.taskId as string);
    }
  }

  return delivered;
}

export async function orchestrateRestart(
  deps: OrchestrateRestartDeps,
  event: RestartOrchestratorEvent
): Promise<void> {
  const { chatroomId, role } = event;

  markRestartOrchestratorInFlight(chatroomId, role, event.correlationId);
  try {
    resetRoleDeliveryState(chatroomId, role);

    await deps.agentMgr.stop({
      chatroomId,
      role,
      reason: 'user.restart',
    });

    const spawnResult = await Effect.runPromise(
      deps.agentMgr.ensureRunning({
        chatroomId,
        role,
        agentHarness: event.agentHarness as AgentHarness,
        model: event.model,
        workingDir: event.workingDir,
        reason: 'user.restart',
        wantResume: event.wantResume ?? true,
      })
    );

    if (!spawnResult.success || !spawnResult.pid) {
      await emitPhase(deps, event, 'failed', spawnResult.error ?? 'spawn failed');
      return;
    }

    const harnessSessionId = await waitForHarnessSessionId(deps, event, spawnResult.pid);
    if (!harnessSessionId) {
      await emitPhase(deps, event, 'failed', 'harnessSessionId timeout');
      return;
    }

    await forceNativeWaiting(deps, event);

    const deliveredTaskIds = await deliverPendingTasks(deps, event);

    await emitRestartCompleted(deps, event, deliveredTaskIds);
  } catch (err) {
    console.warn(`[RestartOrchestrator] failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`);
    await emitPhase(deps, event, 'failed', getErrorMessage(err));
  } finally {
    clearRestartOrchestratorInFlight(chatroomId, role, event.correlationId);
  }
}
