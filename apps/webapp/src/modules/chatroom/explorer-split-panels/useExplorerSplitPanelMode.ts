'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../hooks/usePersistedState';

export type ExplorerSplitPanelMode = 'messages' | 'direct-harness';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:explorerSplitPanelMode`;

const isValidMode = (v: unknown): v is ExplorerSplitPanelMode =>
  v === 'messages' || v === 'direct-harness';

/**
 * Persists the right-split-panel mode (Messages | Direct Harness) per chatroom.
 * Defaults to 'messages'. Persisted in localStorage under a chatroom-scoped key.
 */
export function useExplorerSplitPanelMode(
  chatroomId: Id<'chatroom_rooms'>
): [ExplorerSplitPanelMode, (mode: ExplorerSplitPanelMode) => void] {
  const key = STORAGE_KEY(chatroomId as string);
  return usePersistedState<ExplorerSplitPanelMode>(key, 'messages', {
    validate: isValidMode,
  });
}
