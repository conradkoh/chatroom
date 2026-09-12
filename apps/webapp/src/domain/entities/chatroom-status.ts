import type {
  ChatroomActivityStatus,
  ChatroomState,
} from '@workspace/shared/domain/chatroom-activity-status';
import {
  deriveChatroomState,
  isChatroomStopAvailable,
} from '@workspace/shared/domain/chatroom-activity-status';

export type ChatroomRemoteAgentStatus = 'running' | 'stopped' | 'none';

/**
 * The webapp's chatroom status read model.
 *
 * The values are derived from Convex projections; this entity contains no
 * client-owned lifecycle state.
 */
export interface ChatroomStatus {
  chatroomId: string;
  activityStatus: ChatroomActivityStatus;
  state: ChatroomState;
  remoteAgentStatus: ChatroomRemoteAgentStatus;
  canStop: boolean;
}

export function createChatroomStatus(
  chatroomId: string,
  activityStatus: ChatroomActivityStatus,
  remoteAgentStatus: ChatroomRemoteAgentStatus
): ChatroomStatus {
  const state: ChatroomState = deriveChatroomState(activityStatus);

  return {
    chatroomId,
    activityStatus,
    state,
    remoteAgentStatus,
    canStop: remoteAgentStatus === 'running' || isChatroomStopAvailable(activityStatus),
  };
}
