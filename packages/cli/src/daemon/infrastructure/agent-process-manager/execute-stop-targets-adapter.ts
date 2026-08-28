import { buildAgentStopRevisionKey } from '@workspace/shared/domain/agent-stop-command';
import {
  normalizeAgentStopRole,
  type AgentStopTargetDescriptor,
} from '@workspace/shared/domain/agent-stop-command';

import type { AgentProcessManager } from './agent-process-manager.js';
import {
  createStopAgentConfirmedDeps,
  type ConfirmedStopAdapterDeps,
} from './stop-agent-confirmed-adapter.js';
import type { AgentHarness } from '../../../infrastructure/machine/types.js';
import { buildExitedLifecycleFact } from '../../domain/entities/agent-lifecycle-fact.js';
import type { AgentStopReason } from '../../domain/entities/agent-stop.js';
import type { StopAgentTargetsDeps } from '../../domain/usecase/stop-agent-targets.js';
import { stopAgentTargets } from '../../domain/usecase/stop-agent-targets.js';

const activeChatroomScopeDepth = new Map<string, number>();
export function isChatroomStopScopeActive(chatroomId: string): boolean {
  return (activeChatroomScopeDepth.get(chatroomId) ?? 0) > 0;
}
// fallow-ignore-next-line unused-export
export function createChatroomScopeBarrier() {
  return {
    acquire: async (chatroomId: string) => {
      activeChatroomScopeDepth.set(chatroomId, (activeChatroomScopeDepth.get(chatroomId) ?? 0) + 1);
      return () => {
        const next = (activeChatroomScopeDepth.get(chatroomId) ?? 1) - 1;
        if (next <= 0) activeChatroomScopeDepth.delete(chatroomId);
        else activeChatroomScopeDepth.set(chatroomId, next);
      };
    },
  };
}
// fallow-ignore-next-line unused-export
export function resetChatroomScopeBarrierForTests(): void {
  activeChatroomScopeDepth.clear();
}
// fallow-ignore-next-line unused-export
export function createStopAgentTargetsDeps(args: {
  apm: AgentProcessManager;
  confirmedDeps: ConfirmedStopAdapterDeps;
}): StopAgentTargetsDeps {
  const confirmed = createStopAgentConfirmedDeps(args.confirmedDeps);
  return {
    ...confirmed,
    machineId: args.confirmedDeps.machineId,
    barrier: createChatroomScopeBarrier(),
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
  // Claim stop intent before discovering targets (which performs async I/O),
  // so recovery cannot win the race while the stop command is being prepared.
  args.apm.markStopIntent(args.chatroomId, args.role, args.reason);
  const deps = createStopAgentTargetsDeps(args);
  const discovered = await args.apm.discoverStopTargets(args.chatroomId);
  const targets = discovered.filter(
    (target) => normalizeAgentStopRole(target.role) === normalizeAgentStopRole(args.role)
  );
  return stopAgentTargets(deps, {
    chatroomId: args.chatroomId,
    scope: { kind: 'agent', role: args.role },
    reason: args.reason,
    targets,
  });
}

export function createStopAgentTargetsDepsForCommand(args: {
  apm: AgentProcessManager;
  confirmedDeps: ConfirmedStopAdapterDeps;
  stopCommandId: string;
}): StopAgentTargetsDeps {
  const base = createStopAgentTargetsDeps(args);
  return {
    ...base,
    buildRevisionKey: (target) =>
      buildAgentStopRevisionKey({ stopCommandId: args.stopCommandId, targetKey: target.targetKey }),
  };
}

export async function runExactTargetsStop(args: {
  apm: AgentProcessManager;
  confirmedDeps: ConfirmedStopAdapterDeps;
  stopCommandId: string;
  chatroomId: string;
  targets: AgentStopTargetDescriptor[];
  reason: AgentStopReason;
}) {
  const deps = createStopAgentTargetsDepsForCommand(args);
  const targets = args.targets.map((target) => ({
    ...target,
    agentHarness: target.agentHarness as AgentHarness,
  }));
  return stopAgentTargets(deps, {
    chatroomId: args.chatroomId,
    scope: { kind: 'chatroom' },
    reason: args.reason,
    targets,
  });
}
