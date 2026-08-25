import { stopAgentConfirmed, type StopAgentConfirmedDeps } from './stop-agent-confirmed.js';
import type { AgentStopScope } from '@workspace/shared/domain/agent-stop-command';
import { normalizeAgentStopRole } from '@workspace/shared/domain/agent-stop-command';
import type {
  AgentStopTargetDescriptor,
  AgentStopOutcome,
  AgentStopReason,
} from '../entities/agent-stop.js';
const SCOPE_TARGET_STOP_TIMEOUT_MS = 10_000;

export interface AgentStopScopeBarrierPort {
  acquire(chatroomId: string): Promise<() => void>;
}
export interface AgentStopTargetDiscoveryPort {
  listTargets(args: {
    chatroomId: string;
    machineId: string;
  }): Promise<AgentStopTargetDescriptor[]>;
}
export interface StopAgentScopeResult {
  targets: { target: AgentStopTargetDescriptor; outcome: AgentStopOutcome }[];
  failures: { target: AgentStopTargetDescriptor; error: unknown }[];
}
export interface StopAgentScopeDeps extends StopAgentConfirmedDeps {
  barrier: AgentStopScopeBarrierPort;
  discovery: AgentStopTargetDiscoveryPort;
  machineId: string;
  buildRevisionKey: (target: AgentStopTargetDescriptor) => string;
}
function matchesScope(target: AgentStopTargetDescriptor, scope: AgentStopScope): boolean {
  return (
    scope.kind === 'chatroom' ||
    normalizeAgentStopRole(target.role) === normalizeAgentStopRole(scope.role)
  );
}
// fallow-ignore-next-line unused-export
export async function stopAgentScope(
  deps: StopAgentScopeDeps,
  args: { chatroomId: string; scope: AgentStopScope; reason: AgentStopReason }
): Promise<StopAgentScopeResult> {
  const release = await deps.barrier.acquire(args.chatroomId);
  try {
    let discovered: AgentStopTargetDescriptor[];
    try { discovered = await deps.discovery.listTargets({
      chatroomId: args.chatroomId,
      machineId: deps.machineId,
    }); } catch (error) { return { targets: [], failures: [{ target: { chatroomId: args.chatroomId, machineId: deps.machineId, role: args.scope.kind === 'agent' ? args.scope.role : 'unknown', pid: -1, agentHarness: 'opencode', targetKey: 'discovery' }, error }] }; }
    const targets = discovered.filter((target) => matchesScope(target, args.scope));
    const outcomes: StopAgentScopeResult['targets'] = [];
    const failures: StopAgentScopeResult['failures'] = [];
    await Promise.all(
      targets.map(async (target) => {
        try {
          const outcome = await stopAgentConfirmed(deps, {
            target,
            reason: args.reason,
            revisionKey: deps.buildRevisionKey(target),
            timeoutMs: SCOPE_TARGET_STOP_TIMEOUT_MS,
          });
          outcomes.push({ target, outcome });
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
