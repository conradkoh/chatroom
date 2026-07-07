'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../usePersistedState';

export const EXPLORER_SIDEBAR_MIN_WIDTH_PX = 180;
export const EXPLORER_SIDEBAR_MAX_WIDTH_PX = 480;

const EXPLORER_SIDEBAR_DEFAULT_WIDTH_PX = 256;

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:explorerSidebarWidth`;

function isValidWidth(v: unknown): v is number {
  return (
    typeof v === 'number' &&
    Number.isFinite(v) &&
    v >= EXPLORER_SIDEBAR_MIN_WIDTH_PX &&
    v <= EXPLORER_SIDEBAR_MAX_WIDTH_PX
  );
}

export function useExplorerSidebarWidth(
  chatroomId: Id<'chatroom_rooms'>
): [number, (width: number) => void] {
  return usePersistedState<number>(
    STORAGE_KEY(chatroomId as string),
    EXPLORER_SIDEBAR_DEFAULT_WIDTH_PX,
    { validate: isValidWidth }
  );
}
