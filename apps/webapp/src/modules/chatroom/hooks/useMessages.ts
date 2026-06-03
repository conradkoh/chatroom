'use client';

/**
 * useMessages — backward-compatible wrapper around useChatroomMessageStore.
 *
 * Prefer useChatroomMessageStore in timeline code paths; this export remains
 * for existing call sites outside the feed stack.
 */

import {
  useChatroomMessageStore,
  type UseChatroomMessageStoreResult,
} from './useChatroomMessageStore';

export type UseMessagesResult = UseChatroomMessageStoreResult;

export function useMessages(chatroomId: string): UseMessagesResult {
  return useChatroomMessageStore(chatroomId);
}
