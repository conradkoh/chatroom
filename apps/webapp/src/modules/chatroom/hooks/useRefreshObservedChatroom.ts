'use client';

import { useCallback, useRef } from 'react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';

import { REFRESH_COOLDOWN_MS } from './useObserveChatroom';

/**
 * Imperative refresh with the same cooldown as {@link useObserveChatroom}'s visibility
 * refresh. Use that hook on the chatroom page for mount/interval/visibility lifecycle;
 * use this hook where a component needs to trigger `refresh: true` on demand (e.g. git panel open).
 *
 * Returns a debounced `refresh` function that explicitly requests an observed-sync
 * refresh for the current chatroom. Call this when the git panel opens or the tab
 * gains focus and an immediate sync is desired.
 *
 * Uses a frontend cooldown to avoid noisy heartbeats. The backend updates
 * lastRefreshedAt on every call; the cooldown is the primary dedupe mechanism.
 */
export function useRefreshObservedChatroom(chatroomId: string | null | undefined) {
  const recordObservation = useSessionMutation(api.chatrooms.recordChatroomObservation);
  const lastRefreshRef = useRef(0);
  const lastRefreshChatroomIdRef = useRef<string | null>(null);

  const refresh = useCallback(() => {
    if (!chatroomId) return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;

    const now = Date.now();
    if (
      lastRefreshChatroomIdRef.current === chatroomId &&
      now - lastRefreshRef.current < REFRESH_COOLDOWN_MS
    ) {
      return;
    }
    lastRefreshRef.current = now;
    lastRefreshChatroomIdRef.current = chatroomId;

    try {
      void recordObservation({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        refresh: true,
      });
    } catch {
      // Fire-and-forget: best-effort
    }
  }, [chatroomId, recordObservation]);

  return { refresh };
}
