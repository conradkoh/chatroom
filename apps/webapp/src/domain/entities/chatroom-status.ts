import type {
  ChatroomActivityStatus,
  ChatroomState,
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
