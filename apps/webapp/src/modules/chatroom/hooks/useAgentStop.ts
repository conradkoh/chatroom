'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback } from 'react';

export interface AgentStopTarget {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  workingDir?: string | undefined;
}

export function useAgentStop() {
  const requestAgent = useSessionMutation(api.agents.requestStop);

  const requestAgentStop = useCallback(
    (target: AgentStopTarget) => requestAgent(target),
    [requestAgent]
  );

  return { requestAgentStop };
}
