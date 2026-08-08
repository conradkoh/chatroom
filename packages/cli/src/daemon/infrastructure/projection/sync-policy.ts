import type { OutboundEvent } from '../../domain/entities/outbound-event.js';

// fallow-ignore-next-line unused-export
export enum SyncTier {
  T0 = 'T0', // local only
  T1 = 'T1', // batched low
  T2 = 'T2', // batched medium
  T3 = 'T3', // immediate
  T4 = 'T4', // on-demand
}

// fallow-ignore-next-line unused-export
export function getTierForOutboundEvent(type: OutboundEvent['type']): SyncTier {
  if (type === 'harness.stream') return SyncTier.T0;
  if (type === 'task.status') return SyncTier.T3;
  if (type === 'handoff.completed') return SyncTier.T3;
  if (type === 'heartbeat') return SyncTier.T1;
  return SyncTier.T2;
}

export function shouldEnqueueOutbox(event: OutboundEvent): boolean {
  return getTierForOutboundEvent(event.type) !== SyncTier.T0;
}
