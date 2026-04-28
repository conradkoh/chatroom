'use client';

import { useEffect, useRef } from 'react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';

import { FRONTEND_OBSERVATION_HEARTBEAT_MS } from '@workspace/backend/config/reliability';

/** Minimum time between refresh calls to avoid noisy heartbeats. */
export const REFRESH_COOLDOWN_MS = 5000;

/**
 * Page-level observation: heartbeat interval, mount + visibility refresh with cooldown.
 * For imperative refresh from a child (e.g. git panel), use {@link useRefreshObservedChatroom}.
 */
export function useObserveChatroom(chatroomId: string | null | undefined) {
  const recordObservation = useSessionMutation(api.chatrooms.recordChatroomObservation);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRefreshRef = useRef(0);
  const lastRefreshChatroomIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!chatroomId) return;

    const fireHeartbeat = async () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;

      try {
        await recordObservation({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
        });
      } catch {
        // Fire-and-forget: best-effort
      }
    };

    const fireRefresh = async () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState !== 'visible') return;

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
        await recordObservation({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          refresh: true,
        });
      } catch {
        // Fire-and-forget: best-effort
      }
    };

    // Mount: send refresh to trigger immediate sync
    fireRefresh();

    // Visibility change to visible: send refresh
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fireRefresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Interval: heartbeat only (keeps TTL alive, no refresh)
    intervalRef.current = setInterval(fireHeartbeat, FRONTEND_OBSERVATION_HEARTBEAT_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [chatroomId, recordObservation]);
}
