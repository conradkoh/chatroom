/**
 * Orchestrates atomic user restart: reset → spawn → await session → ready → deliver pending.
 */

import { HARNESS_SESSION_READY_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import { NATIVE_WAITING_ACTION } from '@workspace/backend/src/domain/entities/participant.js';
import type { AgentRestartPhase } from '@workspace/backend/src/domain/usecase/agent/build-agent-restart-event.js';
import type {
  AssignedTaskSnapshotView,
  AssignedTaskView,
} from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { isDeliverableTaskStatus } from '@workspace/backend/src/domain/usecase/machine/assigned-tasks-types.js';
import { Effect } from 'effect';

import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import { isAgentReadyForNativeDelivery } from './native-ready-invariant.js';
import { resetRoleDeliveryState } from './native-task-delivery-coordinator.js';
import { runNativeInjectionEffect } from './native-task-injector.js';
import type { AgentHarness } from './types.js';
import { api } from '../../../api.js';
import { getErrorMessage } from '../../../utils/convex-error.js';

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

  await deps.session.backend.mutation(api.machines.emitHarnessSessionAwaiting, {
    sessionId: deps.session.sessionId,
    machineId: deps.session.machineId,
    chatroomId: event.chatroomId,
    role: event.role,
    pid,
    timeoutMs: HARNESS_SESSION_READY_TIMEOUT_MS,
  });

  const deadline = Date.now() + HARNESS_SESSION_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const slot = deps.agentMgr.getSlot(event.chatroomId, event.role);
    if (slot?.harnessSessionId) {
      return slot.harnessSessionId;
    }
    await sleep(100);
  }

  await deps.session.backend.mutation(api.machines.emitHarnessSessionTimeout, {
    sessionId: deps.session.sessionId,
    machineId: deps.session.machineId,
    chatroomId: event.chatroomId,
    role: event.role,
    pid,
    timeoutMs: HARNESS_SESSION_READY_TIMEOUT_MS,
  });

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
  })) as { tasks: AssignedTaskSnapshotView[] };

  const slot = deps.agentMgr.getSlot(event.chatroomId, event.role);
  return (result.tasks ?? [])
    .filter(
      (t) =>
        t.chatroomId === event.chatroomId &&
        t.agentConfig.role.toLowerCase() === event.role.toLowerCase() &&
        isDeliverableTaskStatus(t.status as Parameters<typeof isDeliverableTaskStatus>[0]) &&
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

  const full = (await deps.session.backend.query(api.machines.getAssignedTaskForAction, {
    sessionId: deps.session.sessionId,
    machineId: deps.session.machineId,
    taskId: snapshot.taskId,
    role: event.role,
  })) as AssignedTaskView | null;

  if (!full) return false;

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

  try {
    await emitPhase(deps, event, 'reset');
    resetRoleDeliveryState(chatroomId, role);

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

    await deps.session.backend.mutation(api.machines.emitHarnessSessionReady, {
      sessionId: deps.session.sessionId,
      machineId: deps.session.machineId,
      chatroomId,
      role,
      harnessSessionId,
      pid: spawnResult.pid,
    });

    await forceNativeWaiting(deps, event);
    await emitPhase(deps, event, 'ready');

    await emitPhase(deps, event, 'deliver');
    const deliveredTaskIds = await deliverPendingTasks(deps, event);

    await deps.session.backend.mutation(api.machines.emitRestartCompleted, {
      sessionId: deps.session.sessionId,
      machineId: deps.session.machineId,
      chatroomId,
      role,
      correlationId: event.correlationId,
      deliveredTaskIds,
    });
    await emitPhase(deps, event, 'completed');
  } catch (err) {
    console.warn(`[RestartOrchestrator] failed for ${role}@${chatroomId}: ${getErrorMessage(err)}`);
    await emitPhase(deps, event, 'failed', getErrorMessage(err));
  }
}
