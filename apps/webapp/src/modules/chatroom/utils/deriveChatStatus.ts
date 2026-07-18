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
 * Whether an online agent should count as "working" for the chatroom list/dot.
 *
 * Mostly mirrors AgentPanel via `resolveAgentStatus` → `working`
 * (e.g. task.inProgress).  Exception: `agent.awaitingHandoff` resolves to
 * `transitioning` in the agent sidebar (yellow), but the chatroom list treats
 * it as working (blue) so the room does not look idle/green while an agent is
 * blocked on handoff.
 */
function isAgentWorkingForChatStatus(agent: AgentPresence): boolean {
  if (agent.lastStatus === 'agent.awaitingHandoff') return true;
  return resolveAgentStatus(agent.lastStatus, agent.lastDesiredState, true).variant === 'working';
}

/**
 * Derives sidebar chat status from chatroom lifecycle and agent presence.
 *
 * Primary working signal: agent's `lastStatus` / `lastDesiredState` via
 * `resolveAgentStatus` (same inputs as AgentPanel).  See
 * `isAgentWorkingForChatStatus` for the awaiting-handoff exception.
 *
 * Online alive agents blocked on get-next-task (WAITING) are 'active', not 'idle'.
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

  if (onlineAgents.some(isAgentWorkingForChatStatus)) return 'working';
  return 'active';
}
