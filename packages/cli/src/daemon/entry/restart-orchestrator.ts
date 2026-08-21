/**
 * Orchestrates atomic user restart: reset → spawn → await session → ready → deliver pending.
 */

import { HARNESS_SESSION_READY_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import {
  buildAgentRestartCompletedEvent,
  buildAgentRestartPhaseEvent,
  type AgentRestartPhase,
} from '@workspace/backend/src/domain/usecase/agent/build-agent-restart-event.js';
import { parseAssignedTaskMonitorRows } from '@workspace/backend/src/domain/usecase/machine/assigned-task-monitor-contract.js';
import { Effect } from 'effect';

import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import type { AgentHarness } from './daemon-types.js';
import { api } from '../../api.js';
import { getNativeDeliveryLedger } from './native-delivery/native-delivery-ledger.js';
import { isAgentReadyForNativeDelivery } from './native-delivery/native-ready-invariant.js';
import { resetRoleDeliveryState } from './native-delivery/native-task-delivery-coordinator.js';
import {
  explainLedgerDeliveryBlock,
  explainNativeDeliveryBlock,
} from './native-delivery/native-task-injector-logic.js';
import { runNativeInjectionEffect } from './native-delivery/native-task-injector.js';
import {
  markRestartOrchestratorInFlight,
  clearRestartOrchestratorInFlight,
} from './restart-orchestrator-in-flight.js';
import {
  mapAssignedTaskSnapshotList,
  mapAssignedTaskView,
} from '../../infrastructure/mappers/map-assigned-task.js';
import { getErrorMessage } from '../../utils/convex-error.js';
import { isDeliverableTaskStatus } from '../domain/entities/assigned-task.js';
import type { AssignedTaskSnapshotView } from '../domain/entities/assigned-task.js';
import { isTeamAgentRole } from '../domain/entities/execution-kind.js';
import { logDaemonAuditEvent } from '../infrastructure/event-stream/daemon-event-emitter.js';

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
  logEvent: (event: Record<string, unknown>) => Promise<void>;
  backend: {
    mutation: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
    query: (fn: unknown, args: Record<string, unknown>) => Promise<unknown>;
  };
}

interface RestartOrchestratorDeps {
  session: RestartOrchestratorSession;
  agentMgr: DaemonAgentProcessManagerServiceShape;
}

async function emitPhase(
  deps: RestartOrchestratorDeps,
  event: RestartOrchestratorEvent,
  phase: AgentRestartPhase | 'completed' | 'failed',
  detail?: string
): Promise<void> {
  const now = Date.now();
  await logDaemonAuditEvent(
    deps.session.logEvent,
    buildAgentRestartPhaseEvent(
      {
        chatroomId: event.chatroomId as never,
        machineId: deps.session.machineId,
        role: event.role,
        correlationId: event.correlationId,
        phase,
        detail,
      },
      now
    )
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHarnessSessionId(
  deps: RestartOrchestratorDeps,
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
  deps: RestartOrchestratorDeps,
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
  deps: RestartOrchestratorDeps,
  event: RestartOrchestratorEvent
): Promise<AssignedTaskSnapshotView[]> {
  await deps.session.backend.mutation(api.machines.syncMachineAssignedTaskSnapshotsMutation, {
    sessionId: deps.session.sessionId,
    machineId: deps.session.machineId,
  });

  const result = (await deps.session.backend.query(api.machines.listMachineAssignedTaskSnapshots, {
    sessionId: deps.session.sessionId,
    machineId: deps.session.machineId,
  })) as { tasks?: unknown };

  const slot = deps.agentMgr.getSlot(event.chatroomId, event.role);
  return mapAssignedTaskSnapshotList(parseAssignedTaskMonitorRows(result.tasks ?? []))
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
  deps: RestartOrchestratorDeps,
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
  const deliveryBlock = explainNativeDeliveryBlock(snapshot, { slot });
  if (deliveryBlock) {
    console.warn(`[RestartOrchestrator] skip task ${snapshot.taskId} — ${deliveryBlock}`);
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
        logEvent: deps.session.logEvent,
        backend: deps.session.backend,
        convexUrl: deps.session.convexUrl,
        agentMgr: {
          resumeTurnForSlot: async (args) => {
            await Effect.runPromise(deps.agentMgr.resumeTurnForSlot(args));
          },
          stop: (opts) => Effect.runPromise(deps.agentMgr.stop(opts)),
          ensureRunning: (opts) => Effect.runPromise(deps.agentMgr.ensureRunning(opts)),
          getSlot: (chatroomId, role) => deps.agentMgr.getSlot(chatroomId, role),
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
  deps: RestartOrchestratorDeps,
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

export async function runRestartOrchestrator(
  deps: RestartOrchestratorDeps,
  event: RestartOrchestratorEvent
): Promise<void> {
  const { chatroomId, role } = event;

  markRestartOrchestratorInFlight(chatroomId, role, event.correlationId);
  try {
    resetRoleDeliveryState(chatroomId, role);

    await emitPhase(deps, event, 'reset');
    await deps.agentMgr.stop({
      chatroomId,
      role,
      reason: 'user.restart',
    });

    await emitPhase(deps, event, 'spawn');
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

    await emitPhase(deps, event, 'await_session');
    const harnessSessionId = await waitForHarnessSessionId(deps, event, spawnResult.pid);
    if (!harnessSessionId) {
      await emitPhase(deps, event, 'failed', 'harnessSessionId timeout');
      return;
    }

    await forceNativeWaiting(deps, event);
    await emitPhase(deps, event, 'ready');

    await emitPhase(deps, event, 'deliver');
    const deliveredTaskIds = await deliverPendingTasks(deps, event);

    await emitPhase(deps, event, 'completed');
    await logDaemonAuditEvent(
      deps.session.logEvent,
      buildAgentRestartCompletedEvent(
        {
          chatroomId: event.chatroomId as never,
          machineId: deps.session.machineId,
          role: event.role,
          correlationId: event.correlationId,
          deliveredTaskIds,
        },
        Date.now()
      )
    );
  } catch (err) {
    console.warn(`[RestartOrchestrator] failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`);
    await emitPhase(deps, event, 'failed', getErrorMessage(err));
  } finally {
    clearRestartOrchestratorInFlight(chatroomId, role, event.correlationId);
  }
}
