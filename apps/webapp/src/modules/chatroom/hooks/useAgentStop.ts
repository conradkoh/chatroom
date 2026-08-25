'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

export interface AgentStopTarget {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  reason?: 'user.stop';
}

export function useAgentStop() {
  const requestStop = useSessionMutation(api.agentStops.request);
  const [isStopping, setIsStopping] = useState(false);

  const stopAgent = useCallback(
    async (target: AgentStopTarget) => {
      await requestStop({
        chatroomId: target.chatroomId,
        machineId: target.machineId,
        role: target.role,
        reason: target.reason ?? 'user.stop',
      });
    },
    [requestStop]
  );

  const stopAgents = useCallback(
    async (targets: AgentStopTarget[]) => {
      if (targets.length === 0) return { fulfilled: 0, rejected: [] as AgentStopTarget[] };
      setIsStopping(true);
      try {
        const results = await Promise.allSettled(targets.map((target) => stopAgent(target)));
        const rejected = targets.filter((_, index) => results[index]?.status === 'rejected');
        return { fulfilled: targets.length - rejected.length, rejected };
      } finally {
        setIsStopping(false);
      }
    },
    [stopAgent]
  );

  return { stopAgent, stopAgents, isStopping };
}
