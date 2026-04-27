'use client';

import { useEffect, useRef } from 'react';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { api } from '@workspace/backend/convex/_generated/api';

// TODO: keep in sync with FRONTEND_OBSERVATION_HEARTBEAT_MS in services/backend/config/reliability.ts
const FRONTEND_OBSERVATION_HEARTBEAT_MS = 30_000;

export function useObserveChatroom(chatroomId: string | null | undefined) {
  const recordObservation = useSessionMutation(api.chatrooms.recordChatroomObservation);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!chatroomId) return;

    const fireObservation = async () => {
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

    fireObservation();

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fireObservation();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    intervalRef.current = setInterval(fireObservation, FRONTEND_OBSERVATION_HEARTBEAT_MS);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [chatroomId, recordObservation]);
}
