import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';

export type NativeTurnPhase = 'idle' | 'injecting' | 'turn_in_flight';

export function defaultNativeTurnPhase(): NativeTurnPhase {
  return 'idle';
}

/** Harness turn is complete — safe to inject next task (Slice 3 will use this for delivery gate). */
// fallow-ignore-next-line unused-export
export function isNativeSlotIdleForDelivery(slot: AgentSlot | undefined): boolean {
  if (slot?.state !== 'running') return false;
  return (slot.nativeTurnPhase ?? defaultNativeTurnPhase()) === 'idle';
}

export function setNativeTurnPhase(slot: AgentSlot, phase: NativeTurnPhase): void {
  slot.nativeTurnPhase = phase;
}
