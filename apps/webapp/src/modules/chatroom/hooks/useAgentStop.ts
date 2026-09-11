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
  const requestAgent = useSessionMutation(api.chatroomWorkspaceAgentCommandsInbox.requestStopAgent);
  const requestChatroom = useSessionMutation(
    api.chatroomWorkspaceAgentCommandsInbox.requestStopAll
  );

  const requestAgentStop = useCallback(
    (target: AgentStopTarget) => requestAgent(target),
    [requestAgent]
  );
  const requestChatroomStop = useCallback(
    (chatroomId: Id<'chatroom_rooms'>) => requestChatroom({ chatroomId }),
    [requestChatroom]
  );

  return { requestAgentStop, requestChatroomStop };
}
