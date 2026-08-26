'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

export interface AgentStopTarget {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
}

export type AgentStopState = 'idle' | 'pending' | 'stopping' | 'stopped' | 'failed';

export function isActiveAgentStopState(state?: AgentStopState | string | null) {
  return state === 'pending' || state === 'stopping';
}

export function useAgentStop() {
  const requestAgent = useSessionMutation(api.agentStops.requestAgent);
  const requestChatroom = useSessionMutation(api.agentStops.requestChatroom);

  const requestAgentStop = useCallback(
    (target: AgentStopTarget) => requestAgent({ ...target, reason: 'user.stop' }),
    [requestAgent]
  );
  const requestChatroomStop = useCallback(
    (chatroomId: Id<'chatroom_rooms'>) => requestChatroom({ chatroomId, reason: 'user.stop' }),
    [requestChatroom]
  );

  return { requestAgentStop, requestChatroomStop };
}
