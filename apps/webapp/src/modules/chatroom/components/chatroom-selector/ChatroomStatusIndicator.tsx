'use client';

import type { ChatroomActivityStatus } from '@workspace/shared/domain/chatroom-activity-status';

import {
  getChatroomActivityDescription,
  getChatroomActivityIndicatorClasses,
  getChatroomActivityIndicatorLoadingClasses,
} from '../../utils/activityStatusDisplay';

/** Activity dot for a chatroom. Shows a loading dot until the first status arrives. */
export function ChatroomStatusIndicator({
  activityStatus,
}: {
  activityStatus?: ChatroomActivityStatus;
}) {
  const status = activityStatus;
  return (
    <span
      className={
        status
          ? getChatroomActivityIndicatorClasses(status)
          : getChatroomActivityIndicatorLoadingClasses()
      }
      title={status ? getChatroomActivityDescription(status) : 'Loading agent status'}
      aria-label={status ? getChatroomActivityDescription(status) : 'Loading agent status'}
    />
  );
}
