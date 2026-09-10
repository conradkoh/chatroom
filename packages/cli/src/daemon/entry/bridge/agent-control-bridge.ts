import { api } from '../../../api.js';
import type { Id } from '../../../api.js';
import type { RestartAgentDeps } from '../../domain/usecase/restart-agent.js';
import type { StartAgentDeps } from '../../domain/usecase/start-agent.js';
import { logDaemonAuditEvent } from '../../infrastructure/event-stream/daemon-event-emitter.js';
import type {
  AgentProcessManagerService,
  NativeDeliveryService,
} from '../../services/service-interfaces.js';
import type {
  DaemonAgentProcessManagerServiceShape,
  DaemonSessionServiceShape,
} from '../daemon-services.js';
import type { AgentHarness, StartAgentReason } from '../daemon-types.js';
import { runRestartOrchestrator } from '../restart-orchestrator.js';

export function createStartAgentDeps(
  session: DaemonSessionServiceShape,
  processManagerService: AgentProcessManagerService
): StartAgentDeps {
  return {
    agentProcessManager: {
      startAgent: async (args) => {
        await processManagerService.startAgent({
          chatroomId: args.chatroomId as Id<'chatroom_rooms'>,
          role: args.role,
          agentHarness: args.agentHarness as AgentHarness,
          model: args.model,
          workingDir: args.workingDir,
          reason: args.reason as StartAgentReason,
          wantResume: args.wantResume,
        });
      },
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

export function createRestartAgentDeps(
  agentMgr: DaemonAgentProcessManagerServiceShape,
  session: DaemonSessionServiceShape,
  processManagerService: AgentProcessManagerService,
  nativeDelivery: Pick<NativeDeliveryService, 'requestReconcile'>
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
            runSerializedForAgent: processManagerService.runSerializedForAgent,
            nativeDelivery,
            taskService: session.taskService,
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
