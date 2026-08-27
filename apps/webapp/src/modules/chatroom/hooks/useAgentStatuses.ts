'use client';

import { useMemo } from 'react';

import type { AgentRoleStatusReadModel } from './useAgentPanelData';
import type { TeamLifecycle } from '../types/readiness';
import {
  isWorkingVariant,
  resolveAgentStatus,
  type StatusVariant,
} from '../utils/agentStatusLabel';

/**
 * Whether an online agent should use blue WORKING styling.
 * Derived from `resolveAgentStatus` so label text and square icon always share
 * the same semantic variant (blue = working only).
 */
// fallow-ignore-next-line unused-export
export function deriveAgentIsWorking(
  latestEventType: string | null | undefined,
  desiredState: string | null | undefined,
  online: boolean
): boolean {
  const { variant } = resolveAgentStatus(latestEventType, desiredState, online);
  return online && isWorkingVariant(variant);
}

export interface AgentStatus {
  role: string;
  online: boolean;
  lastSeenAt: number | null;
  statusLabel: string;
  statusVariant: StatusVariant;
  isWorking: boolean;
  latestEventType: string | null;
}

export type AggregateStatus = 'working' | 'ready' | 'partial' | 'none';

export interface UseAgentStatusesResult {
  agents: AgentStatus[];
  aggregateStatus: AggregateStatus;
  lifecycle: TeamLifecycle | null | undefined;
  isLoading: boolean;
}

/**
 * Centralizes agent status derivation for a chatroom.
 * Online status is derived from `isAlive` (spawnedAgentPid via getTeamLifecycle).
 * Rich status labels (WORKING, WAITING, etc.) still use participant.lastStatus event types.
 */
export function useAgentStatuses(
  roles: string[],
  participants: TeamLifecycle['participants'] | undefined,
  statusReadModel: AgentRoleStatusReadModel[] | undefined
): UseAgentStatusesResult {
  const lifecycle = participants === undefined ? undefined : ({ participants } as TeamLifecycle);

  const participantMap = useMemo(() => {
    if (!participants)
      return new Map<string, NonNullable<typeof lifecycle>['participants'][number]>();
    return new Map(participants.map((p) => [p.role.toLowerCase(), p]));
  }, [participants]);

  const statusReadModelMap = useMemo(
    () => new Map((statusReadModel ?? []).map((row) => [row.role.toLowerCase(), row])),
    [statusReadModel]
  );

  const agents = useMemo((): AgentStatus[] => {
    return roles.map((role) => {
      const participant = participantMap.get(role.toLowerCase());
      const readModel = statusReadModelMap.get(role.toLowerCase());
      if (readModel) {
        const status = resolveReadModelStatus(readModel.status);
        const online = readModel.status !== 'offline' && readModel.status !== 'error';
        return {
          role,
          online,
          lastSeenAt: readModel.lastSeenAt ?? null,
          statusLabel: status.label,
          statusVariant: status.variant,
          isWorking: status.variant === 'working',
          latestEventType: null,
        };
      }
      const lastSeenAt = participant?.lastSeenAt ?? null;
      const latestEventType = participant?.lastStatus ?? null;
      const desiredState = participant?.lastDesiredState ?? null;
      const online = participant?.isAlive ?? false;
      const { label: statusLabel, variant: statusVariant } = resolveAgentStatus(
        latestEventType,
        desiredState,
        online
      );
      const isWorking = deriveAgentIsWorking(latestEventType, desiredState, online);
      return {
        role,
        online,
        lastSeenAt,
        statusLabel,
        statusVariant,
        isWorking,
        latestEventType,
      };
    });
  }, [roles, participantMap, statusReadModelMap]);

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
    lifecycle,
    isLoading: lifecycle === undefined,
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
