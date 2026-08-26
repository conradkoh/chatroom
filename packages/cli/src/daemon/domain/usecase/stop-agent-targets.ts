import { SCOPE_TARGET_STOP_TIMEOUT_MS } from '@workspace/backend/config/reliability.js';
import type { AgentStopScope } from '@workspace/shared/domain/agent-stop-command';

import { stopAgentConfirmed, type StopAgentConfirmedDeps } from './stop-agent-confirmed.js';
import { AgentStopError } from '../entities/agent-stop.js';
import type {
  AgentStopTargetDescriptor,
  AgentStopOutcome,
  AgentStopReason,
} from '../entities/agent-stop.js';

export interface AgentStopScopeBarrierPort {
  acquire(chatroomId: string): Promise<() => void>;
}
export interface StopAgentTargetsResult {
  targets: {
    target: AgentStopTargetDescriptor;
    outcome: AgentStopOutcome;
    lifecycleWarning?: string;
  }[];
  failures: { target: AgentStopTargetDescriptor; error: unknown }[];
}
export interface StopAgentTargetsDeps extends StopAgentConfirmedDeps {
  barrier: AgentStopScopeBarrierPort;
  machineId: string;
  buildRevisionKey: (target: AgentStopTargetDescriptor) => string;
}
// fallow-ignore-next-line unused-export
export async function stopAgentTargets(
  deps: StopAgentTargetsDeps,
  args: {
    chatroomId: string;
    scope: AgentStopScope;
    reason: AgentStopReason;
    targets?: AgentStopTargetDescriptor[];
  }
): Promise<StopAgentTargetsResult> {
  const release = await deps.barrier.acquire(args.chatroomId);
  try {
    const targets = args.targets ?? [];
    const outcomes: StopAgentTargetsResult['targets'] = [];
    const failures: StopAgentTargetsResult['failures'] = [];
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
          if (error instanceof AgentStopError && error.code === 'lifecycle_delivery_failed') {
            outcomes.push({
              target,
              outcome: { kind: 'stopped', pid: target.pid, termination: 'graceful' },
              lifecycleWarning: error.message,
            });
            return;
          }
          failures.push({ target, error });
        }
      })
    );
    return { targets: outcomes, failures };
  } finally {
    release();
  }
}
