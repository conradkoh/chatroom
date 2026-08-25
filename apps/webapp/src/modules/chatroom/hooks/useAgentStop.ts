'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo } from 'react';

export interface AgentStopTarget {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  reason?: 'user.stop';
}

export function useAgentStop(chatroomId?: Id<'chatroom_rooms'>) {
  const requestStop = useSessionMutation(api.agentStops.request);
  const status = useSessionQuery(api.machines.getAgentViewStatus, chatroomId ? { chatroomId } : 'skip');
  const isRoleStopping = useCallback((role: string) => {
    const agent = status?.agents.find((item) => item.role.toLowerCase() === role.toLowerCase());
    return agent?.stopState === 'pending' || agent?.stopState === 'stopping';
  }, [status]);
  const isStopping = useMemo(() => status?.agents.some((agent) => agent.stopState === 'pending' || agent.stopState === 'stopping') ?? false, [status]);

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
      const results = await Promise.allSettled(targets.map((target) => stopAgent(target)));
      const rejected = targets.filter((_, index) => results[index]?.status === 'rejected');
      return { fulfilled: targets.length - rejected.length, rejected };
    },
    [stopAgent]
  );

  return { stopAgent, stopAgents, isStopping, isRoleStopping };
}
