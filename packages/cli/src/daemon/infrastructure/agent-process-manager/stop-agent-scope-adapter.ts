import type { AgentProcessManager } from './agent-process-manager.js';
import {
  createStopAgentConfirmedDeps,
  type ConfirmedStopAdapterDeps,
} from './stop-agent-confirmed-adapter.js';
import { buildExitedLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type { AgentStopReason } from '../../domain/entities/agent-stop.js';
import type { StopAgentScopeDeps } from '../../domain/usecase/stop-agent-scope.js';
import { stopAgentScope } from '../../domain/usecase/stop-agent-scope.js';
import { buildAgentStopRevisionKey } from '@workspace/shared/domain/agent-stop-command';
import type { AgentStopScope } from '@workspace/shared/domain/agent-stop-command';

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
export async function runRoleScopedStop(args: {
  apm: AgentProcessManager;
  confirmedDeps: ConfirmedStopAdapterDeps;
  chatroomId: string;
  role: string;
  reason: AgentStopReason;
}) {
  const deps = createStopAgentScopeDeps(args);
  return stopAgentScope(deps, {
    chatroomId: args.chatroomId,
    scope: { kind: 'agent', role: args.role },
    reason: args.reason,
  });
}

export function createStopAgentScopeDepsForCommand(args: { apm: AgentProcessManager; confirmedDeps: ConfirmedStopAdapterDeps; stopCommandId: string }): StopAgentScopeDeps {
  const base = createStopAgentScopeDeps(args);
  return { ...base, buildRevisionKey: (target) => buildAgentStopRevisionKey({ stopCommandId: args.stopCommandId, targetKey: target.targetKey }) };
}

export async function runScopedStopFromInbox(args: { apm: AgentProcessManager; confirmedDeps: ConfirmedStopAdapterDeps; stopCommandId: string; chatroomId: string; scope: AgentStopScope; reason: AgentStopReason }) {
  const deps = createStopAgentScopeDepsForCommand(args);
  return stopAgentScope(deps, { chatroomId: args.chatroomId, scope: args.scope, reason: args.reason });
}
