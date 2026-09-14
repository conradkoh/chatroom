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

export function useAgentStop() {
  const requestAgent = useSessionMutation(api.agents.requestStop);
  const requestChatroomOperation = useSessionMutation(api.agents.requestChatroomAgentOperation);

  const requestAgentStop = useCallback(
    (target: AgentStopTarget) => requestAgent(target),
    [requestAgent]
  );
  const requestChatroomStop = useCallback(
    (chatroomId: Id<'chatroom_rooms'>) =>
      requestChatroomOperation({ chatroomId, operation: 'stop' }),
    [requestChatroomOperation]
  );

  const requestChatroomStart = useCallback(
    (chatroomId: Id<'chatroom_rooms'>) =>
      requestChatroomOperation({ chatroomId, operation: 'start' }),
    [requestChatroomOperation]
  );
  const requestChatroomRestart = useCallback(
    (chatroomId: Id<'chatroom_rooms'>) =>
      requestChatroomOperation({ chatroomId, operation: 'restart' }),
    [requestChatroomOperation]
  );

  return { requestAgentStop, requestChatroomStop, requestChatroomStart, requestChatroomRestart };
}
