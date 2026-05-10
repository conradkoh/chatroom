'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../hooks/usePersistedState';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:explorerSplitViewEnabled`;

/**
 * Persisted boolean for the explorer-split chat-panel open/close state.
 *
 * Stored per-chatroom in localStorage. Defaults to `false` (panel hidden).
 */
export function useExplorerSplitViewEnabled(
  chatroomId: Id<'chatroom_rooms'>
): [boolean, (enabled: boolean) => void] {
  const key = STORAGE_KEY(chatroomId as string);
  return usePersistedState<boolean>(key, false);
}
