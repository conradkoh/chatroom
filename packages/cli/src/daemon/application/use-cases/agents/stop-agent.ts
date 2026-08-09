// fallow-ignore-file unused-file complexity
import { buildAgentStopTimeoutEvent } from '../../../domain/events/agent-lifecycle.js';
import type { AgentReadModelRow } from '../../../infrastructure/persistence/read-models/agents.js';
import type { AgentLifecyclePort } from '../../ports/agent-lifecycle.port.js';

export interface StopAgentInput {
  chatroomId: string;
  role: string;
  pid?: number;
  /** When set, the stop timed out — emit the local stop-timeout lifecycle event. */
  stopTimedOut?: boolean;
  durationMs?: number;
  timestamp?: number;
}

export interface StopAgentDeps {
  machineId: string;
  lifecycle: Pick<AgentLifecyclePort, 'appendLifecycleEvent' | 'updateAgentReadModel'>;
  now?: () => number;
}

/**
 * Local agent-stop/exit lifecycle handling. Clears the agent read model and,
 * on a hung stop, appends the stop-timeout lifecycle event for batched
 * projection to Convex.
 */
export function stopAgent(deps: StopAgentDeps, input: StopAgentInput): void {
  const timestamp = deps.now?.() ?? Date.now();

  if (input.stopTimedOut) {
    deps.lifecycle.appendLifecycleEvent(
      buildAgentStopTimeoutEvent({
        chatroomId: input.chatroomId,
        role: input.role,
        machineId: deps.machineId,
        pid: input.pid,
        durationMs: input.durationMs ?? 0,
        timestamp,
      })
    );
  }

  const agentRow: AgentReadModelRow = {
    machineId: deps.machineId,
    role: input.role,
    pid: undefined,
    updatedAt: timestamp,
  };
  deps.lifecycle.updateAgentReadModel(agentRow);
}
