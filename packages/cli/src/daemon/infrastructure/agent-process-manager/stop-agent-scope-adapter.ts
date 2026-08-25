import type { AgentProcessManager } from './agent-process-manager.js';
import {
  createStopAgentConfirmedDeps,
  type ConfirmedStopAdapterDeps,
} from './stop-agent-confirmed-adapter.js';
import { buildExitedLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type {
  AgentStopReason,
  AgentStopTargetDescriptor,
} from '../../domain/entities/agent-stop.js';
import { stopAgentConfirmed } from '../../domain/usecase/stop-agent-confirmed.js';
import type { StopAgentScopeDeps } from '../../domain/usecase/stop-agent-scope.js';

const activeChatroomScopes = new Set<string>();
export function isChatroomStopScopeActive(chatroomId: string): boolean {
  return activeChatroomScopes.has(chatroomId);
}
// fallow-ignore-next-line unused-export
export function createChatroomScopeBarrier() {
  return {
    acquire: async (chatroomId: string) => {
      activeChatroomScopes.add(chatroomId);
      return () => activeChatroomScopes.delete(chatroomId);
    },
  };
}
// fallow-ignore-next-line unused-export
export function createStopAgentScopeDeps(args: {
  apm: AgentProcessManager;
  confirmedDeps: ConfirmedStopAdapterDeps;
}): StopAgentScopeDeps {
  const confirmed = createStopAgentConfirmedDeps(args.confirmedDeps);
  return {
    ...confirmed,
    machineId: args.confirmedDeps.machineId,
    barrier: createChatroomScopeBarrier(),
    discovery: { listTargets: ({ chatroomId }) => args.apm.discoverStopTargets(chatroomId) },
    buildRevisionKey: (target) =>
      buildExitedLifecycleFact(
        {
          sessionId: args.confirmedDeps.sessionId,
          machineId: args.confirmedDeps.machineId,
          chatroomId: target.chatroomId,
          role: target.role,
          pid: target.pid,
          stopReason: 'user.stop',
          agentHarness: target.agentHarness,
        },
        args.confirmedDeps.clock.now()
      ).revisionKey,
  };
}
// fallow-ignore-next-line unused-export
export async function stopAgentScopeWithBracket(
  apm: AgentProcessManager,
  deps: StopAgentScopeDeps,
  args: { chatroomId: string; scope: { kind: 'agent'; role: string }; reason: AgentStopReason }
) {
  const release = await deps.barrier.acquire(args.chatroomId);
  try {
    const discovered = await deps.discovery.listTargets({
      chatroomId: args.chatroomId,
      machineId: deps.machineId,
    });
    const targets = discovered.filter(
      (target) => target.role.trim().toLowerCase() === args.scope.role.trim().toLowerCase()
    );
    const outcomes: {
      target: AgentStopTargetDescriptor;
      outcome: Awaited<ReturnType<typeof stopAgentConfirmed>>;
    }[] = [];
    const failures: { target: AgentStopTargetDescriptor; error: unknown }[] = [];
    await Promise.all(
      targets.map(async (target) => {
        try {
          const result = await apm.withScopedRoleStop<
            Awaited<ReturnType<typeof stopAgentConfirmed>>
          >(
            {
              chatroomId: args.chatroomId,
              role: target.role,
              reason: args.reason as any,
              pid: target.pid,
            },
            ({ preserveForResume }) =>
              stopAgentConfirmed(deps, {
                target,
                reason: args.reason,
                revisionKey: deps.buildRevisionKey(target),
                preserveForResume,
              })
          );
          if (result.ok) outcomes.push({ target, outcome: result.value });
          else failures.push({ target, error: new Error(result.reason) });
        } catch (error) {
          failures.push({ target, error });
        }
      })
    );
    return { targets: outcomes, failures };
  } finally {
    release();
  }
}
export async function runRoleScopedStop(args: {
  apm: AgentProcessManager;
  confirmedDeps: ConfirmedStopAdapterDeps;
  chatroomId: string;
  role: string;
  reason: AgentStopReason;
}) {
  const deps = createStopAgentScopeDeps(args);
  return stopAgentScopeWithBracket(args.apm, deps, {
    chatroomId: args.chatroomId,
    scope: { kind: 'agent', role: args.role },
    reason: args.reason,
  });
}
