/** Activity status values projected for one agent role in a chatroom. */
export type ChatroomAgentActivityStatusValue =
  'offline' | 'starting' | 'waiting' | 'working' | 'stopping' | 'error';

/** Activity status projected for one agent role in a chatroom. */
export type ChatroomAgentActivityStatus = {
  status: ChatroomAgentActivityStatusValue;
};

/** Shared semantic variants used by per-agent and aggregate status displays. */
export type ChatroomAgentActivityVariant =
  'offline' | 'error' | 'transitioning' | 'ready' | 'working';

/** Map a projected agent status to its semantic UI variant. */
// fallow-ignore-next-line complexity
export function deriveChatroomAgentActivityVariant(
  status: ChatroomAgentActivityStatusValue
): ChatroomAgentActivityVariant {
  switch (status) {
    case 'starting':
    case 'stopping':
      return 'transitioning';
    case 'waiting':
      return 'ready';
    case 'working':
      return 'working';
    case 'error':
      return 'error';
    case 'offline':
      return 'offline';
  }
}

/**
 * Whether a projected status represents an available agent process.
 *
 * This is the canonical per-agent "agent is active" rule: starting, waiting, working, and
 * stopping are active; offline and error are not.
 */
export function isChatroomAgentActivityOnline(status: ChatroomAgentActivityStatusValue): boolean {
  return status !== 'offline' && status !== 'error';
}

/**
 * True when any agent in the chatroom is active. Chatroom-level `running` is derived from this.
 *
 * The daemon's active-workspace rule must stay in step with this predicate. Wiring that
 * rule is a later slice, so this is the rule to change first.
 */
export function hasActiveChatroomAgent(agents: readonly ChatroomAgentActivityStatus[]): boolean {
  return agents.some((agent) => isChatroomAgentActivityOnline(agent.status));
}
