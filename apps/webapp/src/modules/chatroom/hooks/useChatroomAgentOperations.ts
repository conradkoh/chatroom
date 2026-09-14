'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

/** Chatroom-wide lifecycle actions for all agents across its active workspaces. */
export function useChatroomAgentOperations() {
  const requestOperation = useSessionMutation(api.agents.requestChatroomAgentOperation);

  const startAgents = useCallback(
    (chatroomId: Id<'chatroom_rooms'>) => requestOperation({ chatroomId, operation: 'start' }),
    [requestOperation]
  );
  const stopAgents = useCallback(
    (chatroomId: Id<'chatroom_rooms'>) => requestOperation({ chatroomId, operation: 'stop' }),
    [requestOperation]
  );
  const restartAgents = useCallback(
    (chatroomId: Id<'chatroom_rooms'>) => requestOperation({ chatroomId, operation: 'restart' }),
    [requestOperation]
  );

  return { startAgents, stopAgents, restartAgents };
}
