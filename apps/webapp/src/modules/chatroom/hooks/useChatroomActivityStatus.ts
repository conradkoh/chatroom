'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { ChatroomActivityStatus } from '@workspace/shared/domain/chatroom-activity-status';
import { deriveChatroomActivityStatus } from '@workspace/shared/domain/chatroom-activity-status';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import { useChatroomListing } from '../context/ChatroomListingContext';
/** Returns the chatroom activity status from projected per-role status rows. */
export function useChatroomActivityStatus(chatroomId: string): ChatroomActivityStatus {
  const { chatrooms } = useChatroomListing();
  const chatroom = chatrooms?.find((entry) => entry._id === chatroomId);
  const projectedStatuses = useSessionQuery(api.machines.getAgentRoleStatusReadModel, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });

  return useMemo(() => {
    return deriveChatroomActivityStatus(chatroom?.status, projectedStatuses ?? []);
  }, [chatroom?.status, projectedStatuses]);
}
