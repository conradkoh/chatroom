/**
 * Agent status label utilities — shared between useAgentStatuses.ts and InlineAgentCard.tsx.
 *
 * Final approved label matrix:
 *
 *   Event Type         | desiredState    | Label           | Color
 *   -------------------|-----------------|-----------------|--------
 *   null (no events)   | any             | OFFLINE         | Grey
 *   agent.registered   | any             | REGISTERED      | Yellow
 *   agent.waiting      | running/undef   | WAITING         | Green
 *   agent.waiting      | stopped         | STOPPING        | Yellow
 *   agent.requestStart | any             | STARTING        | Yellow
 *   agent.started      | any             | STARTED         | Green
 *   agent.requestStop  | stopped         | STOPPING        | Yellow
 *   task.acknowledged  | any             | TASK RECEIVED   | Yellow
 *   task.inProgress    | any             | WORKING         | Blue (pulse)
 *   task.completed     | any             | WAITING          | Green
 *   agent.awaitingHandoff | any         | AWAITING HANDOFF | Yellow
 *   agent.exited       | stopped         | OFFLINE         | Grey
 *   agent.exited       | running/undef   | OFFLINE (ERROR) | Red
 *   agent.circuitOpen  | any             | OFFLINE (ERROR) | Red
 *   agent.startFailed  | any             | OFFLINE (ERROR) | Red
 */

/** Semantic status variant used to select indicator color in the UI. */
export type StatusVariant =
  | 'offline' // Grey — not started or cleanly stopped
  | 'error' // Red — crash or circuit breaker
  | 'transitioning' // Yellow — starting, stopping, registered
  | 'ready' // Green — waiting or task received
  | 'working'; // Blue pulse — actively processing

/** Blue WORKING styling applies only when the resolved variant is `working`. */
export function isWorkingVariant(variant: StatusVariant): boolean {
  return variant === 'working';
}

/**
 * Resolved status: the label string plus the semantic color variant.
 * Components use the variant to render the correct indicator color.
 */
export interface ResolvedAgentStatus {
  label: string;
  variant: StatusVariant;
}

// ── SSOT: every event type that can appear in participant.lastStatus ──────
export const AGENT_STATUS_EVENT_TYPES = [
  'agent.registered',
  'agent.requestStart',
  'agent.started',
  'agent.restart',
  'agent.waiting',
  'agent.requestStop',
  'agent.exited',
  'agent.startFailed',
  'agent.circuitOpen',
  'agent.resumeStormAborted',
  'agent.awaitingHandoff',
  'agent.sessionResumeRequested',
  'agent.sessionResumed',
  'agent.sessionResumeFailed',
  'agent.sessionReopenRetry',
  'task.acknowledged',
  'task.inProgress',
  'task.completed',
] as const;

export type AgentStatusEventType = (typeof AGENT_STATUS_EVENT_TYPES)[number];

// Types that need desiredState to resolve — handled in switch, not static map
type DesiredStateDependentType = 'agent.waiting' | 'agent.exited' | 'agent.requestStop';
type StaticStatusEventType = Exclude<AgentStatusEventType, DesiredStateDependentType>;

const STATIC_STATUS_RESOLUTIONS: Record<StaticStatusEventType, ResolvedAgentStatus> = {
  'agent.registered': { label: 'REGISTERED', variant: 'transitioning' },
  'agent.requestStart': { label: 'STARTING', variant: 'transitioning' },
  'agent.started': { label: 'STARTED', variant: 'ready' },
  'agent.restart': { label: 'RESTARTING', variant: 'transitioning' },
  'agent.startFailed': { label: 'OFFLINE (ERROR)', variant: 'error' },
  'agent.circuitOpen': { label: 'OFFLINE (ERROR)', variant: 'error' },
  'agent.resumeStormAborted': { label: 'OFFLINE (ERROR)', variant: 'error' },
  'agent.awaitingHandoff': { label: 'AWAITING HANDOFF', variant: 'transitioning' },
  'agent.sessionResumeRequested': { label: 'RECONNECTING', variant: 'transitioning' },
  'agent.sessionResumed': { label: 'RECONNECTED', variant: 'ready' },
  'agent.sessionResumeFailed': { label: 'RECONNECT FAILED', variant: 'error' },
  'agent.sessionReopenRetry': { label: 'RECONNECTING', variant: 'transitioning' },
  'task.acknowledged': { label: 'TASK RECEIVED', variant: 'transitioning' },
  'task.inProgress': { label: 'WORKING', variant: 'working' },
  'task.completed': { label: 'WAITING', variant: 'ready' },
};

export function isAgentStatusEventType(type: string): type is AgentStatusEventType {
  return (AGENT_STATUS_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * Resolves the agent's user-facing status label and color variant.
 *
 * @param eventType    Latest event type from `chatroom_eventStream` (null if no events)
 * @param desiredState From `chatroom_teamAgentConfigs.desiredState` (null if not set)
 * @param online       Whether the agent is considered online (derived from isAlive / spawnedAgentPid)
 */
export function resolveAgentStatus(
  eventType: string | null | undefined,
  desiredState: string | null | undefined,
  _online: boolean
): ResolvedAgentStatus {
  if (eventType === null || eventType === undefined) {
    return { label: 'OFFLINE', variant: 'offline' };
  }

  // DesiredState-dependent cases
  if (eventType === 'agent.exited') {
    const isIntentional = desiredState === 'stopped';
    return isIntentional
      ? { label: 'OFFLINE', variant: 'offline' }
      : { label: 'OFFLINE (ERROR)', variant: 'error' };
  }

  if (eventType === 'agent.waiting') {
    if (desiredState === 'stopped') return { label: 'STOPPING', variant: 'transitioning' };
    return { label: 'WAITING', variant: 'ready' };
  }

  if (eventType === 'agent.requestStop') {
    return { label: 'STOPPING', variant: 'transitioning' };
  }

  // Static resolutions — exhaustive via Record type
  if (isAgentStatusEventType(eventType)) {
    const resolution = STATIC_STATUS_RESOLUTIONS[eventType as StaticStatusEventType];
    if (resolution) return resolution;
  }

  // NOTE: task.activated is intentionally NOT mapped here. It fires at task
  // creation (pending status) before any agent claims the task, so mapping it
  // to "TASK RECEIVED" would be misleading. Only task.acknowledged (which fires
  // when an agent actually claims a task) should show "TASK RECEIVED".

  // Unknown runtime type (future backend addition) — safe fallback
  return { label: 'ONLINE', variant: 'transitioning' };
}
