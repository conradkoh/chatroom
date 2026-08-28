import type { ChatroomAgentActivityStatus } from './chatroom-agent-activity-status';
import type { ChatroomStatus } from './chatroom-status';

/** User-facing aggregate status derived from agent activity in a chatroom. */
export type ChatroomActivityStatus = 'working' | 'active' | 'transitioning' | 'idle' | 'completed';

/** Derive the chatroom activity status from resolved per-role status projections. */
export function deriveChatroomActivityStatus(
  chatroomStatus: ChatroomStatus | undefined,
  agentStatuses: readonly ChatroomAgentActivityStatus[]
): ChatroomActivityStatus {
  if (chatroomStatus === 'completed') return 'completed';
  if (agentStatuses.some((agent) => agent.status === 'working')) return 'working';
  if (
    agentStatuses.some(
      (agent) =>
        agent.status === 'starting' || agent.status === 'stopping' || agent.status === 'error'
    )
  )
    return 'transitioning';
  if (agentStatuses.some((agent) => agent.status === 'waiting')) return 'active';
  return 'idle';
}
