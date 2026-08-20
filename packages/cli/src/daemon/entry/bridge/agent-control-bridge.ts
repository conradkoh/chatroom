import { Effect } from 'effect';

import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import type { StopReason } from '../../../infrastructure/machine/stop-reason.js';
import type { RecoverAgentStateDeps } from '../../domain/usecase/recover-agent-state.js';
import type { RestartAgentDeps } from '../../domain/usecase/restart-agent.js';
import type { StartAgentDeps } from '../../domain/usecase/start-agent.js';
import type { StopAgentDeps } from '../../domain/usecase/stop-agent.js';
import { logDaemonAuditEvent } from '../../infrastructure/event-stream/daemon-event-emitter.js';
import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonSessionServiceShape,
} from '../daemon-services.js';
import type { AgentHarness, StartAgentReason } from '../daemon-types.js';
import { runRestartOrchestrator } from '../restart-orchestrator.js';

export function createStartAgentDeps(
  agentMgr: DaemonAgentProcessManagerServiceShape,
  session: DaemonSessionServiceShape
): StartAgentDeps {
  return {
    agentProcessManager: {
      ensureRunning: async (args) =>
        Effect.runPromise(
          agentMgr.ensureRunning({
            chatroomId: args.chatroomId as Id<'chatroom_rooms'>,
            role: args.role,
            agentHarness: args.agentHarness as AgentHarness,
            model: args.model,
            workingDir: args.workingDir,
            reason: args.reason as StartAgentReason,
            wantResume: args.wantResume,
          })
        ),
    },
    session: {
      sessionId: session.sessionId,
      machineId: session.machineId,
      hostname: session.config?.hostname ?? 'unknown',
      emitAgentStartFailed: async (args) => {
        try {
          await logDaemonAuditEvent(session.logEvent, {
            type: 'agent.startFailed',
            chatroomId: args.chatroomId,
            role: args.role,
            machineId: session.machineId,
            error: args.error,
          });
          await session.backend.mutation(api.daemon.agentEvents.agentStartFailed, {
            sessionId: session.sessionId,
            machineId: session.machineId,
            chatroomId: args.chatroomId as Id<'chatroom_rooms'>,
            role: args.role,
            error: args.error,
          });
        } catch (err) {
          console.log(`   ⚠️  Failed to emit startFailed event: ${(err as Error).message}`);
        }
      },
      registerWorkspace: async (args) => {
        try {
          await session.backend.mutation(api.workspaces.registerWorkspace, {
            sessionId: session.sessionId,
            machineId: session.machineId,
            chatroomId: args.chatroomId as Id<'chatroom_rooms'>,
            workingDir: args.workingDir,
            hostname: session.config?.hostname ?? 'unknown',
            registeredBy: args.registeredBy,
          });
        } catch (err) {
          console.warn(`[daemon] ⚠️ Failed to register workspace: ${(err as Error).message}`);
        }
      },
    },
  };
}

export function createStopAgentDeps(
  agentMgr: DaemonAgentProcessManagerServiceShape
): StopAgentDeps {
  return {
    agentProcessManager: {
      stop: async (args) =>
        Effect.runPromise(
          agentMgr.stop({
            chatroomId: args.chatroomId,
            role: args.role,
            reason: args.reason as StopReason,
            pid: args.pid,
          })
        ),
    },
  };
}

export function createRestartAgentDeps(
  agentMgr: DaemonAgentProcessManagerServiceShape,
  session: DaemonSessionServiceShape
): RestartAgentDeps {
  return {
    restartOrchestrator: {
      runRestart: async (input) =>
        runRestartOrchestrator(
          {
            session: {
              sessionId: session.sessionId,
              machineId: session.machineId,
              convexUrl: session.convexUrl,
              logEvent: session.logEvent,
              backend: session.backend,
            },
            agentMgr,
          },
          {
            chatroomId: input.chatroomId as Id<'chatroom_rooms'>,
            role: input.role,
            agentHarness: input.agentHarness,
            model: input.model,
            workingDir: input.workingDir,
            correlationId: input.correlationId,
            wantResume: input.wantResume,
          }
        ),
    },
  };
}

export function createRecoverAgentStateDeps(
  agentMgr: DaemonAgentProcessManagerServiceShape,
  session: DaemonSessionServiceShape
): RecoverAgentStateDeps {
  return {
    agentProcessManager: {
      recover: async () => Effect.runPromise(agentMgr.recover()),
      listActive: () =>
        agentMgr.listActive().map((slot) => ({
          chatroomId: slot.chatroomId,
          role: slot.role,
        })),
    },
    backend: {
      getMachineAgentConfigs: async (chatroomId) =>
        session.backend.query(api.machines.getMachineAgentConfigs, {
          sessionId: session.sessionId,
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        }) as Promise<{
          configs: { machineId: string; workingDir?: string; role: string }[];
        }>,
      registerWorkspace: async (args) =>
        session.backend.mutation(api.workspaces.registerWorkspace, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          chatroomId: args.chatroomId as Id<'chatroom_rooms'>,
          workingDir: args.workingDir,
          hostname: session.config?.hostname ?? 'unknown',
          registeredBy: args.registeredBy,
        }),
      getMachineHarnessSessions: async () =>
        session.backend.query(api.daemon.directHarness.turns.getMachineHarnessSessions, {
          sessionId: session.sessionId,
          machineId: session.machineId,
        }) as Promise<{ chatroomId: string; harnessSessionId: string }[]>,
      markOrphanTurnsFailed: async (harnessSessionId) =>
        session.backend.mutation(api.daemon.directHarness.turns.markOrphanTurnsFailed, {
          sessionId: session.sessionId,
          machineId: session.machineId,
          harnessSessionId,
        }) as Promise<{ failedTurns: number }>,
    },
    session: {
      sessionId: session.sessionId,
      machineId: session.machineId,
      hostname: session.config?.hostname ?? 'unknown',
    },
  };
}
