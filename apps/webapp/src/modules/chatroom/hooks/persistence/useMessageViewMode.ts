'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { isValidMessageViewMode, type MessageViewMode } from './messageViewMode';
import { usePersistedState } from '../usePersistedState';

export type { MessageViewMode } from './messageViewMode';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:messageViewMode`;

export function useMessageViewMode(
  chatroomId: Id<'chatroom_rooms'> | string
): [MessageViewMode, (mode: MessageViewMode) => void] {
  const key = STORAGE_KEY(chatroomId as string);
  return usePersistedState<MessageViewMode>(key, 'all', { validate: isValidMessageViewMode });
}
