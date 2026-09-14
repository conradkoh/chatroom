import { AGENT_SLOT_STATE, type AgentSlotState } from '../entities/agent-slot.js';
import type { NativeTurnPhase } from '../entities/native-turn-phase.js';

// fallow-ignore-next-line unused-export
export const AGENT_SLOT_STATES = Object.values(AGENT_SLOT_STATE) as AgentSlotState[];

export function isSlotIdle(state: AgentSlotState): boolean {
  return state === AGENT_SLOT_STATE.IDLE;
}

export function isSlotSpawning(state: AgentSlotState): boolean {
  return state === AGENT_SLOT_STATE.SPAWNING;
}

export function isSlotRunning(state: AgentSlotState): boolean {
  return state === AGENT_SLOT_STATE.RUNNING;
}

export function isSlotStopping(state: AgentSlotState): boolean {
  return state === AGENT_SLOT_STATE.STOPPING;
}

export function isTurnPhaseIdle(phase: NativeTurnPhase): boolean {
  return phase === 'idle';
}
