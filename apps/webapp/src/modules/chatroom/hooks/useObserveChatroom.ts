'use client';

import { FRONTEND_OBSERVATION_HEARTBEAT_MS } from '@workspace/backend/config/reliability';
import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useEffect, useRef } from 'react';

/**
 * Page-level chatroom observation: mount + interval heartbeats.
 *
 * Heartbeats keep the workspace-list subscription scoped to chatrooms the
 * actively viewing. Git/command pushes are enqueued on handoff-to-user and other
 * explicit triggers — not on regular observation heartbeats.
 */
export function useObserveChatroom(chatroomId: string | null | undefined) {
  const recordObservation = useSessionMutation(api.chatrooms.recordChatroomObservation);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  useEffect(() => {
    if (!chatroomId) return;

    void fireHeartbeat();

    intervalRef.current = setInterval(() => {
      void fireHeartbeat();
    }, FRONTEND_OBSERVATION_HEARTBEAT_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [chatroomId, fireHeartbeat]);
}
