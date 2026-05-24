'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../usePersistedState';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:explorerSyncWithEditor`;

const isValidBoolean = (v: unknown): v is boolean => typeof v === 'boolean';

/**
 * Persisted boolean for the Explorer↔active-editor sync preference.
 *
 * When enabled, selecting a file tab reveals and highlights that file in the
 * Explorer tree. Defaults to `true` (sync enabled).
 *
 * Stored per-chatroom in localStorage.
 */
export function useExplorerSyncPreference(
  chatroomId: Id<'chatroom_rooms'>
): [boolean, (enabled: boolean) => void] {
  const key = STORAGE_KEY(chatroomId as string);
  return usePersistedState<boolean>(key, true, { validate: isValidBoolean });
}
