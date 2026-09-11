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

import type { DaemonAgentProcessManagerServiceShape } from './daemon-services.js';
import type { AgentHarness } from './daemon-types.js';
import {
  markRestartOrchestratorInFlight,
  clearRestartOrchestratorInFlight,
} from './restart-orchestrator-in-flight.js';
import { api } from '../../api.js';
import { getErrorMessage } from '../../utils/convex-error.js';
import { isTeamAgentRole } from '../domain/entities/execution-kind.js';
import { logDaemonAuditEvent } from '../infrastructure/event-stream/daemon-event-emitter.js';
import { resetRoleDeliveryState } from '../services/service-interfaces.js';
import type {
  AgentWorkManager,
  AgentProcessManagerService,
} from '../services/service-interfaces.js';

interface RestartOrchestratorEvent {
  chatroomId: string;
  role: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  correlationId: string;
  wantResume: boolean;
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
  runSerializedForAgent: AgentProcessManagerService['runSerializedForAgent'];
  nativeDelivery: Pick<AgentWorkManager, 'reconcileAfterAgentRestart'>;
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
  event: RestartOrchestratorEvent
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

export async function runRestartOrchestrator(
  deps: RestartOrchestratorDeps,
  event: RestartOrchestratorEvent
): Promise<void> {
  const { chatroomId, role } = event;

  markRestartOrchestratorInFlight(chatroomId, role, event.correlationId);
  try {
    resetRoleDeliveryState(chatroomId, role);

    await emitPhase(deps, event, 'reset');

    await emitPhase(deps, event, 'spawn');
    const spawnResult = await deps.runSerializedForAgent(
      { chatroomId, role },
      { timeoutMs: HARNESS_SESSION_READY_TIMEOUT_MS },
      async (ops, context) => {
        await ops.stopAgent({ chatroomId, role, reason: 'user.restart' }, context.signal);
        return ops.startAgent(
          {
            chatroomId,
            role,
            agentHarness: event.agentHarness as AgentHarness,
            model: event.model,
            workingDir: event.workingDir,
            reason: 'user.restart',
            wantResume: event.wantResume,
          },
          context.signal
        );
      }
    );

    if (!spawnResult.success || !spawnResult.pid) {
      await emitPhase(deps, event, 'failed', spawnResult.error ?? 'spawn failed');
      return;
    }

    await emitPhase(deps, event, 'await_session');
    const harnessSessionId = await waitForHarnessSessionId(deps, event);
    if (!harnessSessionId) {
      await deps.runSerializedForAgent(
        { chatroomId, role },
        { timeoutMs: HARNESS_SESSION_READY_TIMEOUT_MS },
        (ops, context) =>
          ops.stopAgent(
            { chatroomId, role, reason: 'user.restart', pid: spawnResult.pid },
            context.signal
          )
      );
      await emitPhase(deps, event, 'failed', 'harnessSessionId timeout');
      return;
    }

    await forceNativeWaiting(deps, event);
    await emitPhase(deps, event, 'ready');

    await emitPhase(deps, event, 'deliver');
    const deliveredTaskIds = await deps.nativeDelivery.reconcileAfterAgentRestart({
      chatroomId,
      role,
    });

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
