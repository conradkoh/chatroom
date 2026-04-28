'use client';

import { useCallback, useEffect, useRef } from 'react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';

import { FRONTEND_OBSERVATION_HEARTBEAT_MS } from '@workspace/backend/config/reliability';

/** Minimum time between refresh calls to avoid noisy heartbeats. */
export const REFRESH_COOLDOWN_MS = 5000;

/**
 * Page-level chatroom observation: interval heartbeat, mount + visibility refresh (with cooldown).
 * Returns `refresh` for imperative triggers (e.g. git panel open); pass it to children — do not
 * call this hook twice for the same chatroom.
 */
export function useObserveChatroom(chatroomId: string | null | undefined) {
  const recordObservation = useSessionMutation(api.chatrooms.recordChatroomObservation);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastRefreshRef = useRef(0);
  const lastRefreshChatroomIdRef = useRef<string | null>(null);

  const fireHeartbeat = useCallback(async () => {
    if (!chatroomId) return;
    if (typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;

    try {
      await recordObservation({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
      });
    } catch {
      // Fire-and-forget: best-effort
    }
  }, [chatroomId, recordObservation]);

  const fireRefresh = useCallback(async () => {
    if (!chatroomId) return;
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
  }, [chatroomId, recordObservation]);

  const refresh = useCallback(() => {
    void fireRefresh();
  }, [fireRefresh]);

  useEffect(() => {
    if (!chatroomId) return;

    void fireRefresh();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fireRefresh();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    intervalRef.current = setInterval(() => {
      void fireHeartbeat();
    }, FRONTEND_OBSERVATION_HEARTBEAT_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [chatroomId, fireRefresh, fireHeartbeat]);

  return { refresh };
}
