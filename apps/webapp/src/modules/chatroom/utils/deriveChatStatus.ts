export type ChatStatus = 'working' | 'active' | 'idle' | 'completed';

export interface AgentPresence {
  lastSeenAction: string | null;
  isAlive: boolean;
}

/**
 * Derives sidebar chat status from chatroom lifecycle and agent presence.
 * Online alive agents blocked on get-next-task are active (running), not idle.
 */
export function deriveChatStatus(
  chatroomStatus: 'active' | 'completed',
  agents: AgentPresence[]
): ChatStatus {
  if (chatroomStatus === 'completed') {
    return 'completed';
  }

  const onlineAgents = agents.filter((a) => a.lastSeenAction !== 'exited' && a.isAlive);
  if (onlineAgents.length === 0) {
    return 'idle';
  }

  const hasWorking = onlineAgents.some(
    (a) => a.lastSeenAction && a.lastSeenAction !== 'get-next-task:started'
  );

  if (hasWorking) return 'working';
  return 'active';
}
