'use client';

import {
  deriveChatroomAgentActivityVariant,
  isChatroomAgentActivityOnline,
} from '@workspace/shared/domain/chatroom-agent-activity-status';
import type { ChatroomAgentActivityVariant } from '@workspace/shared/domain/chatroom-agent-activity-status';
import { useMemo } from 'react';

import type { AgentRoleStatusReadModel } from './useAgentPanelData';

export interface AgentStatus {
  role: string;
  online: boolean;
  lastSeenAt: number | null;
  statusLabel: string;
  statusVariant: ChatroomAgentActivityVariant;
  isWorking: boolean;
}

export type AggregateStatus = 'working' | 'ready' | 'partial' | 'none';

export interface UseAgentStatusesResult {
  agents: AgentStatus[];
  aggregateStatus: AggregateStatus;
  isLoading: boolean;
}

/**
 * Centralizes agent status derivation for a chatroom.
 * All user-facing status values come from the projected role-status read model.
 * Participant event fields are deliberately not used as a fallback.
 */
export function useAgentStatuses(
  roles: string[],
  statusReadModel: AgentRoleStatusReadModel[] | undefined
): UseAgentStatusesResult {
  const statusReadModelMap = useMemo(
    () => new Map((statusReadModel ?? []).map((row) => [row.role.toLowerCase(), row])),
    [statusReadModel]
  );

  const agents = useMemo((): AgentStatus[] => {
    return roles.map((role) => {
      const readModel = statusReadModelMap.get(role.toLowerCase());
      const statusValue = readModel?.status ?? 'offline';
      const statusVariant = deriveChatroomAgentActivityVariant(statusValue);
      return {
        role,
        online: readModel ? isChatroomAgentActivityOnline(statusValue) : false,
        lastSeenAt: readModel?.lastSeenAt ?? null,
      statusLabel: statusLabelForStatus(statusValue),
        statusVariant,
        isWorking: statusVariant === 'working',
      };
    });
  }, [roles, statusReadModelMap]);

  const aggregateStatus = useMemo((): AggregateStatus => {
    const nonUserAgents = agents.filter((a) => a.role.toLowerCase() !== 'user');
    if (nonUserAgents.length === 0) return 'none';
    const onlineAgents = nonUserAgents.filter((a) => a.online);
    if (onlineAgents.length === 0) return 'none';
    if (onlineAgents.some((a) => a.isWorking)) return 'working';
    if (onlineAgents.length === nonUserAgents.length) return 'ready';
    return 'partial';
  }, [agents]);

  return {
    agents,
    aggregateStatus,
    isLoading: statusReadModel === undefined,
  };
}

function statusLabelForStatus(status: AgentRoleStatusReadModel['status']): string {
  switch (status) {
    case 'starting':
      return 'STARTING';
    case 'waiting':
      return 'WAITING';
    case 'working':
      return 'WORKING';
    case 'stopping':
      return 'STOPPING';
    case 'error':
      return 'OFFLINE (ERROR)';
    case 'offline':
      return 'OFFLINE';
  }
}
