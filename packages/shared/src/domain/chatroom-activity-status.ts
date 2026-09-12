import type { ChatroomAgentActivityStatus } from './chatroom-agent-activity-status';
import type { ChatroomStatus } from './chatroom-status';

/** User-facing aggregate status derived from agent activity in a chatroom. */
export const CHATROOM_ACTIVITY_STATUSES = [
  'working',
  'active',
  'transitioning',
  'idle',
  'completed',
] as const;

export type ChatroomActivityStatus = (typeof CHATROOM_ACTIVITY_STATUSES)[number];

/** Runtime-safe enum for the complete set of allowed high-level activity states. */
export const ChatroomActivityStatusEnum = {
  working: 'working',
  active: 'active',
  transitioning: 'transitioning',
  idle: 'idle',
  completed: 'completed',
} as const satisfies { readonly [K in ChatroomActivityStatus]: K };

/** Strict high-level states consumed by chatroom-level UI. */
export const CHATROOM_STATES = ['active', 'attention', 'offline', 'completed'] as const;

export type ChatroomState = (typeof CHATROOM_STATES)[number];

export const ChatroomStateEnum = {
  active: 'active',
  attention: 'attention',
  offline: 'offline',
  completed: 'completed',
} as const satisfies { readonly [K in ChatroomState]: K };

/** Collapse detailed projected activity into the small chatroom state model. */
// fallow-ignore-next-line complexity
export function deriveChatroomState(status: ChatroomActivityStatus): ChatroomState {
  switch (status) {
    case ChatroomActivityStatusEnum.working:
    case ChatroomActivityStatusEnum.active:
      return ChatroomStateEnum.active;
    case ChatroomActivityStatusEnum.transitioning:
      return ChatroomStateEnum.attention;
    case ChatroomActivityStatusEnum.idle:
      return ChatroomStateEnum.offline;
    case ChatroomActivityStatusEnum.completed:
      return ChatroomStateEnum.completed;
  }
}

/** A projected high-level state that can be stopped/reset. */
export function isChatroomStopAvailable(status: ChatroomActivityStatus): boolean {
  const state = deriveChatroomState(status);
  return state === ChatroomStateEnum.active || state === ChatroomStateEnum.attention;
}

/** Derive the chatroom activity status from resolved per-role status projections. */
// fallow-ignore-next-line complexity
export function deriveChatroomActivityStatus(
  chatroomStatus: ChatroomStatus | undefined,
  agentStatuses: readonly ChatroomAgentActivityStatus[]
): ChatroomActivityStatus {
  if (chatroomStatus === ChatroomActivityStatusEnum.completed) return 'completed';
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
