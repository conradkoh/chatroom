import type { OutboundEvent } from '../entities/outbound-event.js';

export type AgentStartFailedEvent = Extract<OutboundEvent, { type: 'agent.start_failed' }>;
export type AgentStopTimeoutEvent = Extract<OutboundEvent, { type: 'agent.stop_timeout' }>;
export type SessionResumeRequestedEvent = Extract<
  OutboundEvent,
  { type: 'session.resume_requested' }
>;
export type SessionResumedEvent = Extract<OutboundEvent, { type: 'session.resumed' }>;
export type SessionResumeFailedEvent = Extract<OutboundEvent, { type: 'session.resume_failed' }>;
export type SessionReopenRetryEvent = Extract<OutboundEvent, { type: 'session.reopen_retry' }>;
export type HarnessSessionIdUpdatedEvent = Extract<
  OutboundEvent,
  { type: 'harness.session_id_updated' }
>;
export type RestartLimitReachedEvent = Extract<OutboundEvent, { type: 'restart.limit_reached' }>;
export type AgentNativeEndEvent = Extract<OutboundEvent, { type: 'agent.native_end' }>;
export type TurnEndedEvent = Extract<OutboundEvent, { type: 'turn.ended' }>;
export type RestartPhaseEvent = Extract<OutboundEvent, { type: 'restart.phase' }>;
export type RestartCompletedEvent = Extract<OutboundEvent, { type: 'restart.completed' }>;

function idem(chatroomId: string, role: string, suffix: string): string {
  return `${chatroomId}:${role}:${suffix}`;
}

export function buildAgentStartFailedEvent(
  fields: Omit<AgentStartFailedEvent, 'type' | 'idempotencyKey'>
): AgentStartFailedEvent {
  return {
    type: 'agent.start_failed',
    idempotencyKey: idem(fields.chatroomId, fields.role, 'start_failed'),
    ...fields,
  };
}

export function buildAgentStopTimeoutEvent(
  fields: Omit<AgentStopTimeoutEvent, 'type' | 'idempotencyKey'>
): AgentStopTimeoutEvent {
  return {
    type: 'agent.stop_timeout',
    idempotencyKey: idem(fields.chatroomId, fields.role, 'stop_timeout'),
    ...fields,
  };
}

export function buildSessionResumeRequestedEvent(
  fields: Omit<SessionResumeRequestedEvent, 'type' | 'idempotencyKey'>
): SessionResumeRequestedEvent {
  return {
    type: 'session.resume_requested',
    idempotencyKey: idem(fields.chatroomId, fields.role, 'resume_requested'),
    ...fields,
  };
}

export function buildSessionResumedEvent(
  fields: Omit<SessionResumedEvent, 'type' | 'idempotencyKey'>
): SessionResumedEvent {
  return {
    type: 'session.resumed',
    idempotencyKey: idem(fields.chatroomId, fields.role, 'resumed'),
    ...fields,
  };
}

export function buildSessionResumeFailedEvent(
  fields: Omit<SessionResumeFailedEvent, 'type' | 'idempotencyKey'>
): SessionResumeFailedEvent {
  return {
    type: 'session.resume_failed',
    idempotencyKey: idem(fields.chatroomId, fields.role, 'resume_failed'),
    ...fields,
  };
}

export function buildSessionReopenRetryEvent(
  fields: Omit<SessionReopenRetryEvent, 'type' | 'idempotencyKey'>
): SessionReopenRetryEvent {
  return {
    type: 'session.reopen_retry',
    idempotencyKey: idem(fields.chatroomId, fields.role, `reopen_retry_${fields.attempt}`),
    ...fields,
  };
}

export function buildHarnessSessionIdUpdatedEvent(
  fields: Omit<HarnessSessionIdUpdatedEvent, 'type' | 'idempotencyKey'>
): HarnessSessionIdUpdatedEvent {
  return {
    type: 'harness.session_id_updated',
    idempotencyKey: idem(fields.chatroomId, fields.role, 'session_id_updated'),
    ...fields,
  };
}

export function buildRestartLimitReachedEvent(
  fields: Omit<RestartLimitReachedEvent, 'type' | 'idempotencyKey'>
): RestartLimitReachedEvent {
  return {
    type: 'restart.limit_reached',
    idempotencyKey: idem(fields.chatroomId, fields.role, 'restart_limit_reached'),
    ...fields,
  };
}

export function buildAgentNativeEndEvent(
  fields: Omit<AgentNativeEndEvent, 'type' | 'idempotencyKey'>
): AgentNativeEndEvent {
  return {
    type: 'agent.native_end',
    idempotencyKey: idem(fields.chatroomId, fields.role, `native_end_${fields.timestamp}`),
    ...fields,
  };
}

export function buildTurnEndedEvent(
  fields: Omit<TurnEndedEvent, 'type' | 'idempotencyKey'>
): TurnEndedEvent {
  return {
    type: 'turn.ended',
    idempotencyKey: idem(fields.chatroomId, fields.role, `turn_ended_${fields.timestamp}`),
    ...fields,
  };
}

export function buildRestartPhaseEvent(
  fields: Omit<RestartPhaseEvent, 'type' | 'idempotencyKey'>
): RestartPhaseEvent {
  return {
    type: 'restart.phase',
    idempotencyKey: idem(fields.chatroomId, fields.role, `restart_phase_${fields.correlationId}`),
    ...fields,
  };
}

export function buildRestartCompletedEvent(
  fields: Omit<RestartCompletedEvent, 'type' | 'idempotencyKey'>
): RestartCompletedEvent {
  return {
    type: 'restart.completed',
    idempotencyKey: idem(
      fields.chatroomId,
      fields.role,
      `restart_completed_${fields.correlationId}`
    ),
    ...fields,
  };
}
