import type { NativeTurnPhase } from '../../../../domain/entities/native-turn-phase.js';

export type { NativeTurnPhase } from '../../../../domain/entities/native-turn-phase.js';

/** Minimal slot capability needed by native turn lifecycle operations. */
export interface NativeTurnSlot {
  state: 'idle' | 'spawning' | 'running' | 'stopping';
  nativeTurnPhase?: NativeTurnPhase | undefined;
}

export function defaultNativeTurnPhase(): NativeTurnPhase {
  return 'idle';
}

/** Harness turn is complete — safe to inject the next task. */
export function isNativeSlotIdleForDelivery(slot: NativeTurnSlot | undefined): boolean {
  if (slot?.state !== 'running') return false;
  return (slot.nativeTurnPhase ?? defaultNativeTurnPhase()) === 'idle';
}

export function setNativeTurnPhase(slot: NativeTurnSlot, phase: NativeTurnPhase): void {
  slot.nativeTurnPhase = phase;
}
