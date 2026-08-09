import type { OutboundEvent } from '../../domain/entities/outbound-event.js';

export enum SyncTier {
  T0 = 'T0', // local only
  T1 = 'T1', // batched low
  T2 = 'T2', // batched medium
  T3 = 'T3', // immediate
  // fallow-ignore-next-line unused-enum-member
  T4 = 'T4', // on-demand
}

// fallow-ignore-next-line complexity
export function getTierForOutboundEvent(type: OutboundEvent['type']): SyncTier {
  if (type === 'harness.stream') return SyncTier.T0;
  if (type === 'turn.ended') return SyncTier.T0;
  if (type === 'task.status') return SyncTier.T3;
  if (type === 'task.claimed') return SyncTier.T3;
  if (type === 'task.status_changed') return SyncTier.T3;
  if (type === 'handoff.completed') return SyncTier.T3;
  if (type === 'user-message.received') return SyncTier.T3;
  if (type === 'heartbeat') return SyncTier.T1;
  // Lifecycle status events (agent start/stop/exit) are T3 immediate; session
  // metadata churn (session_id_updated) is T1 batched.
  switch (type) {
    case 'harness.session_id_updated':
      return SyncTier.T1;
    case 'agent.start_failed':
    case 'agent.stop_timeout':
    case 'session.resume_requested':
    case 'session.resumed':
    case 'session.resume_failed':
    case 'session.reopen_retry':
    case 'restart.limit_reached':
    case 'agent.native_end':
    case 'restart.phase':
    case 'restart.completed':
      return SyncTier.T3;
    default:
      return SyncTier.T2;
  }
}

export function shouldEnqueueOutbox(event: OutboundEvent): boolean {
  return getTierForOutboundEvent(event.type) !== SyncTier.T0;
}
