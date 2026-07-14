import type { NativeTurnPhase } from '../../../commands/machine/daemon-start/native-turn-phase.js';
import type { AgentSlotState } from '../entities/agent-slot.js';

// fallow-ignore-next-line unused-export
export const AGENT_SLOT_STATES = ['idle', 'spawning', 'running', 'stopping'] as const;

export function isSlotIdle(state: AgentSlotState): boolean {
  return state === 'idle';
}

export function isSlotSpawning(state: AgentSlotState): boolean {
  return state === 'spawning';
}

export function isSlotRunning(state: AgentSlotState): boolean {
  return state === 'running';
}

export function isSlotStopping(state: AgentSlotState): boolean {
  return state === 'stopping';
}

export function isTurnPhaseIdle(phase: NativeTurnPhase): boolean {
  return phase === 'idle';
}
