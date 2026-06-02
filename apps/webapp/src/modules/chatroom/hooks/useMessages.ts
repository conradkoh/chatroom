'use client';

/**
 * useMessages — thin wrapper over useChatroomMessageStore for the timeline feed.
 *
 * See useChatroomMessageStore.ts for the cursor + delta + store architecture.
 */

import {
  useChatroomMessageStore,
  type UseChatroomMessageStoreResult,
} from './useChatroomMessageStore';

export type UseMessagesResult = UseChatroomMessageStoreResult;

export function useMessages(chatroomId: string): UseMessagesResult {
  return useChatroomMessageStore(chatroomId);
}
