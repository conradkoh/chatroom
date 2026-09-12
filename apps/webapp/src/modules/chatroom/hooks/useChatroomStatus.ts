'use client';

import type { ChatroomStatus } from '../../../domain/entities/chatroom-status';
import { useChatroomListing } from '../context/ChatroomListingContext';

export interface UseChatroomStatusResult {
  status: ChatroomStatus | undefined;
  isLoading: boolean;
}

/** Selects the Convex-backed status entity for one chatroom. */
export function useChatroomStatus(chatroomId: string): UseChatroomStatusResult {
  const { chatrooms, isLoading } = useChatroomListing();
  const chatroom = chatrooms?.find((entry) => entry._id === chatroomId);

  return {
    status: chatroom?.chatroomStatus,
    isLoading,
  };
}
