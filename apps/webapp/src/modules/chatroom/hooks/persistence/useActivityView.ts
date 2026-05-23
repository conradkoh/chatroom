'use client';

import type { Id } from '@workspace/backend/convex/_generated/dataModel';

import { usePersistedState } from '../usePersistedState';
import type { ActivityView } from '../../components/ActivityBar';

const STORAGE_KEY = (chatroomId: string) => `chatroom:${chatroomId}:activityView`;

const isValidActivityView = (v: unknown): v is ActivityView =>
  v === 'messages' ||
  v === 'explorer' ||
  v === 'direct-harness' ||
  v === 'source-control' ||
  v === 'pull-requests' ||
  v === 'processes';

/**
 * Persisted ActivityView for the chatroom activity bar.
 *
 * Stored per-chatroom in localStorage. Defaults to `'messages'`.
 *
 * Old persisted values ('explorer', 'messages', 'direct-harness') are still
 * valid. New values ('source-control', 'pull-requests') are added — no
 * migration needed since invalid values fall back to the default.
 */
export function useActivityView(
  chatroomId: Id<'chatroom_rooms'>
): [ActivityView, (view: ActivityView) => void] {
  const key = STORAGE_KEY(chatroomId as string);
  return usePersistedState<ActivityView>(key, 'messages', {
    validate: isValidActivityView,
  });
}
