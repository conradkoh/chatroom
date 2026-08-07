/**
 * Slot lifecycle states — must match AgentProcessManager semantics.
 */
export type AgentSlotState = 'idle' | 'spawning' | 'running' | 'stopping';

/** Minimal immutable slot snapshot for pure transition logic. */
export interface AgentSlotSnapshot {
  readonly state: AgentSlotState;
  readonly pid?: number;
  readonly pendingOperationKey?: string; // opaque id when op in flight
}

export const idleSlot = (): AgentSlotSnapshot => ({ state: 'idle' });

export function agentKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}
