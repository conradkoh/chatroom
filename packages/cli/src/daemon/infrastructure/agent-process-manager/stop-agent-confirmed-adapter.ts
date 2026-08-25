import { buildAgentStopTargetKey } from '../../../../../../services/backend/src/domain/entities/agent-stop-command.js';
import { isProcessAlive } from '../../../infrastructure/deps/process.js';
import type { AgentHarness } from '../../../infrastructure/machine/types.js';
import type { Signals } from '../../../infrastructure/types/signals.js';
import {
  buildExitedLifecycleFact,
  type AgentExitAuditArgs,
  type AgentLifecycleFact,
} from '../../domain/entities/agent-lifecycle-fact.js';
import type {
  AgentStopReason,
  AgentStopTargetDescriptor,
} from '../../domain/entities/agent-stop.js';
import { AgentStopError } from '../../domain/entities/agent-stop.js';
import {
  stopAgentConfirmed,
  type StopAgentConfirmedDeps,
} from '../../domain/usecase/stop-agent-confirmed.js';
import { logDaemonAuditEvent } from '../event-stream/daemon-event-emitter.js';
import type { RemoteAgentService } from '../local/harness/services/remote-agent-service.js';

export interface ConfirmedStopAdapterDeps {
  machineId: string;
  sessionId: string;
  agentServices: Map<string, RemoteAgentService>;
  processes: { kill: (pid: number, signal?: number | Signals) => void };
  lifecycleOutbox: { enqueue: (fact: AgentLifecycleFact) => Promise<{ success: boolean }> };
  logEvent: (event: Record<string, unknown>) => Promise<void>;
  clock: { now: () => number };
  killProcessWithFallback: (pid: number) => Promise<void>;
}

export function buildStopTargetDescriptor(args: {
  machineId: string;
  chatroomId: string;
  role: string;
  pid: number;
  agentHarness: AgentHarness;
}): AgentStopTargetDescriptor {
  return { ...args, targetKey: buildAgentStopTargetKey(args) };
}

// fallow-ignore-next-line unused-export
export function createStopAgentConfirmedDeps(
  deps: ConfirmedStopAdapterDeps
): StopAgentConfirmedDeps {
  return {
    liveness: { isAlive: (pid) => isProcessAlive(deps.processes.kill, pid) },
    harnessStop: {
      stop: async (target, opts) => {
        const service = deps.agentServices.get(target.agentHarness);
        if (service) {
          await service.stop(target.pid, opts);
          service.untrack(target.pid);
          return;
        }
        await deps.killProcessWithFallback(target.pid);
      },
    },
    lifecycle: {
      awaitExitedFact: async ({ target, reason }) => {
        const exitArgs: AgentExitAuditArgs = {
          sessionId: deps.sessionId,
          machineId: deps.machineId,
          chatroomId: target.chatroomId,
          role: target.role,
          pid: target.pid,
          stopReason: reason,
          agentHarness: target.agentHarness,
        };
        await logDaemonAuditEvent(deps.logEvent, { type: 'agent.exited', ...exitArgs });
        const result = await deps.lifecycleOutbox.enqueue(
          buildExitedLifecycleFact(exitArgs, deps.clock.now())
        );
        if (!result?.success)
          throw new AgentStopError('lifecycle_delivery_failed', 'Lifecycle outbox enqueue failed');
      },
    },
  };
}

export async function runConfirmedStop(args: {
  deps: ConfirmedStopAdapterDeps;
  target: AgentStopTargetDescriptor;
  reason: AgentStopReason;
  preserveForResume: boolean;
}): Promise<unknown> {
  const exitArgs: AgentExitAuditArgs = {
    sessionId: args.deps.sessionId,
    machineId: args.deps.machineId,
    chatroomId: args.target.chatroomId,
    role: args.target.role,
    pid: args.target.pid,
    stopReason: args.reason,
    agentHarness: args.target.agentHarness,
  };
  const revisionKey = buildExitedLifecycleFact(exitArgs, args.deps.clock.now()).revisionKey;
  return stopAgentConfirmed(createStopAgentConfirmedDeps(args.deps), {
    target: args.target,
    reason: args.reason,
    revisionKey,
    preserveForResume: args.preserveForResume,
  });
}
