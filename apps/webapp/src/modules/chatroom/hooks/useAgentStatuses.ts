'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useMemo } from 'react';

import type { TeamLifecycle } from '../types/readiness';

// ─── Offline event types ────────────────────────────────────────────────────
// Agent is considered offline when their latest event is one of these.
// null/undefined means the agent has never registered (IDLE state).
const OFFLINE_EVENT_TYPES = new Set(['agent.exited', 'agent.circuitOpen', null, undefined]);

// ─── Idle event types ───────────────────────────────────────────────────────
// Agent is online but not actively processing a task.
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
 * Maps a chatroom_eventStream event type to a human-readable status label.
 *
 * Full agent lifecycle:
 *   null/undefined   → IDLE        (never started — no events on record)
 *   agent.registered → REGISTERED  (register-agent called; not yet waiting)
 *   agent.waiting    → WAITING     (get-next-task subscription active; truly ready to receive tasks)
 *   agent.requestStart→ STARTING   (daemon/UI requested agent start)
 *   agent.started    → RUNNING     (agent process confirmed running)
 *   agent.requestStop→ STOPPING    (stop requested; waiting for agent to exit)
 *   agent.exited     → STOPPED     (agent exited cleanly; shown as offline)
 *   agent.circuitOpen→ ERROR       (circuit breaker open; too many crash/restart cycles)
 *   task.acknowledged→ TASK RECEIVED (agent claimed a task via get-next-task)
 *   task.inProgress  → WORKING     (agent called task-started; actively processing)
 *   task.completed   → COMPLETED   (task finished; agent about to return to WAITING)
 */
function eventTypeToStatusLabel(eventType: string | null | undefined): string {
  switch (eventType) {
    // ── Agent has never registered — not started ────────────────────────────
    case null:
    case undefined:
      return 'IDLE';

    // ── Agent lifecycle events ──────────────────────────────────────────────
    case 'agent.registered':
      // Agent registered (register-agent ran) but hasn't started get-next-task yet.
      // Distinguishable from WAITING: the subscription loop isn't active yet.
      return 'REGISTERED';
    case 'agent.waiting':
      // Subscription is active; agent is truly listening for incoming tasks.
      return 'WAITING';
    case 'agent.requestStart':
      return 'STARTING';
    case 'agent.started':
      return 'RUNNING';
    case 'agent.requestStop':
      // Stop was requested; agent is still alive but shutting down.
      return 'STOPPING';
    case 'agent.exited':
      // Agent exited cleanly. Shown with offline indicator.
      return 'STOPPED';
    case 'agent.circuitOpen':
      // Circuit breaker opened: too many crash/restart cycles.
      // Show as an error rather than a generic "CIRCUIT OPEN" label.
      return 'ERROR';

    // ── Task lifecycle events ───────────────────────────────────────────────
    case 'task.acknowledged':
      // Agent claimed the task (pending → acknowledged). Work is imminent.
      return 'TASK RECEIVED';
    case 'task.activated':
      return 'ACTIVE';
    case 'task.inProgress':
      // Agent called task-started and is actively processing.
      // "WORKING" is more intuitive than "IN PROGRESS" for a status badge.
      return 'WORKING';
    case 'task.completed':
      // Task finished. Agent will return to WAITING momentarily.
      return 'COMPLETED';

    default:
      return 'ONLINE';
  }
}

/**
 * Derives a user-facing status label from event type and online state.
 *
 * Offline rules (shown with grey indicator):
 *   - null/undefined (never registered) → "IDLE"   ← distinguishable from "STOPPED"
 *   - agent.exited                       → "STOPPED"
 *   - agent.circuitOpen                  → "ERROR"  (shown even in offline state)
 */
function resolveStatusLabel(latestEventType: string | null, online: boolean): string {
  if (!online) {
    // Offline state — distinguish between never-started, stopped, and error
    if (latestEventType === null || latestEventType === undefined) {
      return 'IDLE'; // Never registered — not started
    }
    if (latestEventType === 'agent.exited') {
      return 'STOPPED'; // Clean exit
    }
    if (latestEventType === 'agent.circuitOpen') {
      return 'ERROR'; // Circuit breaker tripped
    }
    return 'OFFLINE'; // Fallback for other offline states
  }

  return eventTypeToStatusLabel(latestEventType);
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
      // Agent is online if their latest event is NOT agent.exited, agent.circuitOpen, or null
      const online = !OFFLINE_EVENT_TYPES.has(latestEventType as string);
      const isWorking = online && !IDLE_EVENT_TYPES.has(latestEventType as string);
      return {
        role,
        online,
        lastSeenAt,
        statusLabel: resolveStatusLabel(latestEventType, online),
        isWorking,
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
