import type { AgentSlot } from '../../../infrastructure/services/agent-process-manager/agent-process-manager.js';
import type { NativeTurnPhase } from '../../../v2/domain/entities/native-turn-phase.js';

// fallow-ignore-next-line unused-export
export {
  NATIVE_TURN_PHASES,
  type NativeTurnPhase,
} from '../../../v2/domain/entities/native-turn-phase.js';

export function defaultNativeTurnPhase(): NativeTurnPhase {
  return 'idle';
}

/** Harness turn is complete — safe to inject next task. */
// fallow-ignore-next-line unused-export
export function isNativeSlotIdleForDelivery(slot: AgentSlot | undefined): boolean {
  if (slot?.state !== 'running') return false;
  return (slot.nativeTurnPhase ?? defaultNativeTurnPhase()) === 'idle';
}

export function setNativeTurnPhase(slot: AgentSlot, phase: NativeTurnPhase): void {
  slot.nativeTurnPhase = phase;
}
