'use client';

import { useMemo } from 'react';

import type { AgentRoleStatusReadModel } from './useAgentPanelData';
import type { StatusVariant } from '../utils/agentStatusLabel';

export interface AgentStatus {
  role: string;
  online: boolean;
  lastSeenAt: number | null;
  statusLabel: string;
  statusVariant: StatusVariant;
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
      const status = resolveReadModelStatus(readModel?.status ?? 'offline');
      const online =
        readModel?.status !== undefined &&
        readModel.status !== 'offline' &&
        readModel.status !== 'error';
      return {
        role,
        online,
        lastSeenAt: readModel?.lastSeenAt ?? null,
        statusLabel: status.label,
        statusVariant: status.variant,
        isWorking: status.variant === 'working',
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

function resolveReadModelStatus(status: AgentRoleStatusReadModel['status']): {
  label: string;
  variant: StatusVariant;
} {
  switch (status) {
    case 'starting':
      return { label: 'STARTING', variant: 'transitioning' };
    case 'waiting':
      return { label: 'WAITING', variant: 'ready' };
    case 'working':
      return { label: 'WORKING', variant: 'working' };
    case 'stopping':
      return { label: 'STOPPING', variant: 'transitioning' };
    case 'error':
      return { label: 'OFFLINE (ERROR)', variant: 'error' };
    case 'offline':
      return { label: 'OFFLINE', variant: 'offline' };
  }
}
