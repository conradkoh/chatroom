'use client';

import { useCallback, useEffect, useState } from 'react';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

export type ExplorerSplitPanelMode = 'messages' | 'direct-harness';

const STORAGE_KEY = (chatroomId: string) =>
  `chatroom:${chatroomId}:explorerSplitPanelMode`;

function readMode(key: string): ExplorerSplitPanelMode {
  try {
    if (typeof window === 'undefined') return 'messages';
    const stored = localStorage.getItem(key);
    if (stored === 'messages' || stored === 'direct-harness') return stored;
  } catch {
    // localStorage unavailable (private browsing, SSR, etc.)
  }
  return 'messages';
}

function writeMode(key: string, mode: ExplorerSplitPanelMode): void {
  try {
    if (typeof window === 'undefined') return;
    localStorage.setItem(key, mode);
  } catch {
    // ignore write failures
  }
}

/**
 * Persists the right-split-panel mode (Messages | Direct Harness) per chatroom.
 * Defaults to 'messages'. Persisted in localStorage under a chatroom-scoped key.
 */
export function useExplorerSplitPanelMode(
  chatroomId: Id<'chatroom_rooms'>
): [ExplorerSplitPanelMode, (mode: ExplorerSplitPanelMode) => void] {
  const key = STORAGE_KEY(chatroomId as string);

  const [mode, setModeState] = useState<ExplorerSplitPanelMode>(() => readMode(key));

  // Re-sync if chatroomId changes (navigating between chatrooms)
  useEffect(() => {
    setModeState(readMode(key));
  }, [key]);

  const setMode = useCallback(
    (next: ExplorerSplitPanelMode) => {
      writeMode(key, next);
      setModeState(next);
    },
    [key]
  );

  return [mode, setMode];
}
