/** Canonical lifecycle vocabulary shared by all daemon slot implementations. */
export const AGENT_SLOT_STATE = {
  IDLE: 'idle',
  SPAWNING: 'spawning',
  RUNNING: 'running',
  STOPPING: 'stopping',
} as const;

export type AgentSlotState = (typeof AGENT_SLOT_STATE)[keyof typeof AGENT_SLOT_STATE];

/** A start request's daemon-owned disposition. */
export const AGENT_START_DISPOSITION = {
  STARTED: 'started',
  ALREADY_STARTED: 'already_started',
  START_IN_PROGRESS: 'start_in_progress',
} as const;

export type AgentStartDisposition =
  (typeof AGENT_START_DISPOSITION)[keyof typeof AGENT_START_DISPOSITION];

/** Minimal immutable slot snapshot for pure transition logic. */
export interface AgentSlotSnapshot {
  readonly state: AgentSlotState;
  readonly pid?: number | undefined;
  readonly pendingOperationKey?: string | undefined; // opaque id when op in flight
}

export const idleSlot = (): AgentSlotSnapshot => ({ state: AGENT_SLOT_STATE.IDLE });

/**
 * A slot is started when the daemon has completed the running transition and
 * assigned a process identity. The process manager performs the OS liveness
 * check before treating this as an already-started request.
 */
export function isAgentSlotStarted(slot: AgentSlotSnapshot): boolean {
  return slot.state === AGENT_SLOT_STATE.RUNNING && slot.pid !== undefined;
}

/** A start is in flight while the daemon owns the spawn transition. */
export function isAgentSlotStartInFlight(slot: AgentSlotSnapshot): boolean {
  return slot.state === AGENT_SLOT_STATE.SPAWNING;
}

/** Active lifecycle slots are running or spawning; stopping is not started. */
export function isAgentSlotActive(slot: AgentSlotSnapshot): boolean {
  return isAgentSlotStarted(slot) || isAgentSlotStartInFlight(slot);
}

export function agentKey(chatroomId: string, role: string): string {
  return `${chatroomId}:${role.toLowerCase()}`;
}
