import { buildAgentStopTargetKey } from '@workspace/shared/domain/agent-stop-command';

import { isProcessAlive } from '../../../../infrastructure/deps/process.js';
import type { AgentHarness } from '../../../../infrastructure/machine/types.js';
import type { Signals } from '../../../../infrastructure/types/signals.js';
import {
  buildExitedLifecycleFact,
  type AgentExitAuditArgs,
  type AgentLifecycleFact,
} from '../../../domain/entities/agent-lifecycle-fact.js';
import type {
  AgentStopReason,
  AgentStopTargetDescriptor,
} from '../../../domain/entities/agent-stop.js';
import { AgentStopError } from '../../../domain/entities/agent-stop.js';
import {
  stopAgentConfirmed,
  type StopAgentConfirmedDeps,
} from '../../../domain/usecase/stop-agent-confirmed.js';
import { logDaemonAuditEvent } from '../../../infrastructure/event-stream/daemon-event-emitter.js';
import type { RemoteAgentService } from '../../../infrastructure/local/harness/services/remote-agent-service.js';

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
  workingDir?: string | undefined;
}): AgentStopTargetDescriptor {
  return { ...args, targetKey: buildAgentStopTargetKey(args) };
}

export function createStopAgentConfirmedDeps(
  deps: ConfirmedStopAdapterDeps
): StopAgentConfirmedDeps {
  return {
    liveness: { isAlive: (pid) => isProcessAlive(deps.processes.kill, pid) },
    harnessStop: {
      stop: async (target) => {
        const service = deps.agentServices.get(target.agentHarness);
        if (service) {
          await service.stop(target.pid);
          service.untrack(target.pid);
          return;
        }
        await deps.killProcessWithFallback(target.pid);
      },
    },
    lifecycle: {
      enqueueExitedFact: async ({ target, reason, revisionKey }) => {
        const exitArgs: AgentExitAuditArgs = {
          sessionId: deps.sessionId,
          machineId: deps.machineId,
          chatroomId: target.chatroomId,
          role: target.role,
          pid: target.pid,
          stopReason: reason,
          agentHarness: target.agentHarness,
        };
        void logDaemonAuditEvent(deps.logEvent, { type: 'agent.exited', ...exitArgs }).catch(
          (error: unknown) => console.warn('[daemon] Failed to log confirmed agent stop', error)
        );
        // Confirm local persistence; backend delivery is retried independently.
        const result = await deps.lifecycleOutbox.enqueue({
          kind: 'exited',
          chatroomId: target.chatroomId,
          role: target.role,
          pid: target.pid,
          stopReason: reason,
          agentHarness: target.agentHarness,
          revisionKey,
          emittedAt: deps.clock.now(),
        });
        if (!result?.success)
          throw new AgentStopError(
            'lifecycle_delivery_failed',
            'Lifecycle outbox persistence failed'
          );
      },
    },
    forceKill: {
      forceKill: async (target) => {
        await deps.killProcessWithFallback(target.pid);
        deps.agentServices.get(target.agentHarness)?.untrack(target.pid);
      },
    },
  };
}

export async function runConfirmedStop(args: {
  deps: ConfirmedStopAdapterDeps;
  target: AgentStopTargetDescriptor;
  reason: AgentStopReason;
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
  });
}
