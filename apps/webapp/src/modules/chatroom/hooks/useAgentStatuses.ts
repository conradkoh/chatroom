'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import type { TeamLifecycle } from '../types/readiness';

// Event types that indicate the agent is offline (not connected)
const OFFLINE_EVENT_TYPES = new Set(['agent.exited', null, undefined]);

// Idle event types — agent is online but not actively working
const IDLE_EVENT_TYPES = new Set([
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
  isWorking: boolean;
  isStuck: boolean;
  latestEventType: string | null;
}

export type AggregateStatus = 'working' | 'ready' | 'partial' | 'none';

export interface UseAgentStatusesResult {
  agents: AgentStatus[];
  aggregateStatus: AggregateStatus;
  lifecycle: TeamLifecycle | null | undefined;
  isLoading: boolean;
}

/** Maps a chatroom_eventStream event type to a human-readable status label. */
function eventTypeToStatusLabel(eventType: string | null | undefined): string {
  switch (eventType) {
    case 'agent.registered':
      return 'REGISTERED';
    case 'agent.waiting':
      return 'WAITING';
    case 'agent.requestStart':
      return 'STARTING';
    case 'agent.started':
      return 'RUNNING';
    case 'agent.requestStop':
      return 'STOPPING';
    case 'agent.exited':
      return 'STOPPED';
    case 'task.acknowledged':
      return 'TASK RECEIVED';
    case 'task.activated':
      return 'ACTIVE';
    case 'task.inProgress':
      return 'IN PROGRESS';
    case 'task.completed':
      return 'COMPLETED';
    default:
      return 'ONLINE';
  }
}

/** Centralizes agent status derivation from lifecycle participants and event stream. */
export function useAgentStatuses(
  chatroomId: string,
  roles: string[]
): UseAgentStatusesResult {
  const lifecycle = useSessionQuery(api.participants.getTeamLifecycle, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  }) as TeamLifecycle | null | undefined;

  const latestEventsByRole = useSessionQuery(api.machines.getLatestAgentEventsForChatroom, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
    roles,
  }) as Record<string, string> | undefined;

  const participantMap = useMemo(() => {
    if (!lifecycle?.participants) return new Map<string, NonNullable<typeof lifecycle>['participants'][number]>();
    return new Map(lifecycle.participants.map((p) => [p.role.toLowerCase(), p]));
  }, [lifecycle?.participants]);

  const agents = useMemo((): AgentStatus[] => {
    return roles.map((role) => {
      const participant = participantMap.get(role.toLowerCase());
      const lastSeenAt = participant?.lastSeenAt ?? null;
      const latestEventType = latestEventsByRole?.[role.toLowerCase()] ?? null;
      // Agent is online if their latest event is NOT agent.exited and NOT null (never registered)
      const online = !OFFLINE_EVENT_TYPES.has(latestEventType as string);
      const isWorking = online && !IDLE_EVENT_TYPES.has(latestEventType as string);
      return {
        role,
        online,
        lastSeenAt,
        statusLabel: eventTypeToStatusLabel(latestEventType),
        isWorking,
        isStuck: participant?.isStuck === true,
        latestEventType,
      };
    });
  }, [roles, participantMap, latestEventsByRole]);

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
    isLoading: lifecycle === undefined || latestEventsByRole === undefined,
  };
}
