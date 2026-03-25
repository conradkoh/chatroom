'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import type { TeamLifecycle } from '../types/readiness';
import { resolveAgentStatus, type StatusVariant } from '../utils/agentStatusLabel';

// ─── Not-working event types ─────────────────────────────────────────────────
// Agent is online but NOT actively processing a task.
// Used to compute isWorking: if lastStatus is in this set, isWorking = false.
const NOT_WORKING_EVENT_TYPES = new Set([
  'agent.waiting',
  'agent.registered',
  'agent.exited',
  null,
  undefined,
]);

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
 * @deprecated Agent status derivation from participant.lastStatus.
 * The authoritative source for agent status is chatroom_teamAgentConfigs (via AgentRoleView.state).
 * This hook reads from participant.lastStatus which is a denormalized mirror and can diverge.
 * Prefer using AgentRoleView from useAgentPanelData for status derivation.
 *
 * Centralizes agent status derivation from lastStatus on participant records.
 */
export function useAgentStatuses(chatroomId: string, roles: string[]): UseAgentStatusesResult {
  const lifecycle = useSessionQuery(api.participants.getTeamLifecycle, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TeamLifecycle | null | undefined;

  const participantMap = useMemo(() => {
    if (!lifecycle?.participants)
      return new Map<string, NonNullable<typeof lifecycle>['participants'][number]>();
    return new Map(lifecycle.participants.map((p) => [p.role.toLowerCase(), p]));
  }, [lifecycle?.participants]);

  const agents = useMemo((): AgentStatus[] => {
    return roles.map((role) => {
      const participant = participantMap.get(role.toLowerCase());
      const lastSeenAt = participant?.lastSeenAt ?? null;
      const latestEventType = participant?.lastStatus ?? null;
      const desiredState = participant?.lastDesiredState ?? null;
      const online = participant?.isAlive ?? false;
      const isWorking = online && !NOT_WORKING_EVENT_TYPES.has(latestEventType as string);
      const { label: statusLabel, variant: statusVariant } = resolveAgentStatus(
        latestEventType,
        desiredState,
        online
      );
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
  }, [roles, participantMap]);

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
