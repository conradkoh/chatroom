'use client';

import { useMemo } from 'react';

import { useChatroomStatusMap } from './useChatroomStatus';
import { useChatroomListing } from '../context/ChatroomListingContext';

/**
 * The chatroom listing from context, joined with each chatroom's live status.
 * `statuses` is keyed by chatroom id. Callers that need both the list and its statuses use this
 * instead of wiring the two subscriptions themselves.
 */
export function useChatroomListingStatuses() {
  const { chatrooms, isLoading } = useChatroomListing();
  const chatroomIds = useMemo(() => chatrooms?.map((chatroom) => chatroom._id) ?? [], [chatrooms]);
  const { statuses } = useChatroomStatusMap(chatroomIds);
  return { chatrooms, isLoading, statuses };
}
