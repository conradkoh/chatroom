'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../usePersistedState';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:ephemeralAgentsExpanded`;

/**
 * Per-chatroom persisted expansion state for the ephemeral agent group.
 *
 * Constraints:
 * - Defaults to collapsed (`false`); no value means the group starts closed.
 * - The storage key is scoped to the chatroom, so switching rooms restores each
 *   room's own state instead of leaking the previous room's choice.
 * - Values are stored raw JSON booleans; no validation or migration is applied.
 */
export function useEphemeralAgentsExpanded(
  chatroomId: Id<'chatroom_rooms'>
): [boolean, (expanded: boolean) => void] {
  return usePersistedState<boolean>(STORAGE_KEY(chatroomId as string), false);
}
