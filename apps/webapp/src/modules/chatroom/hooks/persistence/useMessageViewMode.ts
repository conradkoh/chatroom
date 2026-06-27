'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../usePersistedState';

export type MessageViewMode = 'all' | 'user-only';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:messageViewMode`;

const isValidMode = (v: unknown): v is MessageViewMode => v === 'all' || v === 'user-only';

export function useMessageViewMode(
  chatroomId: Id<'chatroom_rooms'> | string
): [MessageViewMode, (mode: MessageViewMode) => void] {
  const key = STORAGE_KEY(chatroomId as string);
  return usePersistedState<MessageViewMode>(key, 'all', { validate: isValidMode });
}
