'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../usePersistedState';
import type { ActivityView } from '../../components/ActivityBar';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:activityView`;

const isValidActivityView = (v: unknown): v is ActivityView =>
  v === 'messages' || v === 'explorer' || v === 'direct-harness';

/**
 * Persisted ActivityView for the chatroom activity bar.
 *
 * Stored per-chatroom in localStorage. Defaults to `'messages'`.
 */
export function useActivityView(
  chatroomId: Id<'chatroom_rooms'>
): [ActivityView, (view: ActivityView) => void] {
  const key = STORAGE_KEY(chatroomId as string);
  return usePersistedState<ActivityView>(key, 'messages', {
    validate: isValidActivityView,
  });
}
