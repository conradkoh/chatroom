import { resolveAgentStatus } from './agentStatusLabel';

export type ChatStatus = 'working' | 'active' | 'idle' | 'completed';

export interface AgentPresence {
  /** Latest heartbeat action (presence metadata; online detection uses isAlive). */
  lastSeenAction: string | null;
  /** Latest event-stream event type (e.g. task.inProgress). Canonical working signal. */
  lastStatus: string | null;
  /** Desired lifecycle state (running/stopped) — disambiguates waiting vs stopping. */
  lastDesiredState: string | null;
  isAlive: boolean;
}

/**
 * Derives sidebar chat status from chatroom lifecycle and agent presence.
 *
 * "Working" is derived from the SAME canonical signal as the agent sidebar
 * (AgentPanel / useAgentStatuses): the agent's latest event-stream type
 * (`lastStatus`) resolved through `resolveAgentStatus` to the 'working' variant
 * (task.inProgress / task.completed). This keeps the chatroom sidebar dot in
 * lock-step with the agent panel instead of relying on the divergent
 * `lastSeenAction` heartbeat heuristic.
 *
 * Online alive agents blocked on get-next-task (WAITING) are 'active', not 'idle'.
 *
 * No additional data is required — `lastStatus` / `lastDesiredState` already
 * travel in the existing presence payload, so this is zero extra bandwidth.
 */
export function deriveChatStatus(
  chatroomStatus: 'active' | 'completed',
  agents: AgentPresence[]
): ChatStatus {
  if (chatroomStatus === 'completed') {
    return 'completed';
  }

  const onlineAgents = agents.filter((a) => a.isAlive);
  if (onlineAgents.length === 0) {
    return 'idle';
  }

  const hasWorking = onlineAgents.some(
    (a) => resolveAgentStatus(a.lastStatus, a.lastDesiredState, true).variant === 'working'
  );

  if (hasWorking) return 'working';
  return 'active';
}
