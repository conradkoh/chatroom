'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../usePersistedState';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:harnessPanel:selectedSessionId`;

/**
 * Persisted selected direct-harness session ID for the chatroom.
 *
 * Stored per-chatroom in localStorage. Defaults to `null` (new session).
 */
export function useHarnessSessionId(
  chatroomId: Id<'chatroom_rooms'>
): [string | null, (id: string | null) => void] {
  const key = STORAGE_KEY(chatroomId as string);
  return usePersistedState<string | null>(key, null);
}
