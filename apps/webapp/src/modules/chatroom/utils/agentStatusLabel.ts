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
 *   agent.started      | any             | STARTING        | Yellow (merged)
 *   agent.requestStop  | stopped         | STOPPING        | Yellow
 *   task.acknowledged  | any             | TASK RECEIVED   | Green
 *   task.inProgress    | any             | WORKING         | Blue (pulse)
 *   task.completed     | any             | WORKING         | Blue (pulse)
 *   agent.exited       | stopped         | OFFLINE         | Grey
 *   agent.exited       | running/undef   | OFFLINE (ERROR) | Red
 *   agent.circuitOpen  | any             | OFFLINE (ERROR) | Red
 */

/** Semantic status variant used to select indicator color in the UI. */
export type StatusVariant =
  | 'offline'     // Grey — not started or cleanly stopped
  | 'error'       // Red — crash or circuit breaker
  | 'transitioning' // Yellow — starting, stopping, registered
  | 'ready'       // Green — waiting or task received
  | 'working';    // Blue pulse — actively processing

/**
 * Resolved status: the label string plus the semantic color variant.
 * Components use the variant to render the correct indicator color.
 */
export interface ResolvedAgentStatus {
  label: string;
  variant: StatusVariant;
}

/**
 * Resolves the agent's user-facing status label and color variant.
 *
 * @param eventType    Latest event type from `chatroom_eventStream` (null if no events)
 * @param desiredState From `chatroom_teamAgentConfigs.desiredState` (null if not set)
 * @param online       Whether the agent is considered online (derived from OFFLINE_EVENT_TYPES)
 */
export function resolveAgentStatus(
  eventType: string | null | undefined,
  desiredState: string | null | undefined,
  _online: boolean
): ResolvedAgentStatus {
  // ── No events — agent has never been seen ──────────────────────────────────
  if (eventType === null || eventType === undefined) {
    return { label: 'OFFLINE', variant: 'offline' };
  }

  // ── Offline events — agent exited or circuit open ─────────────────────────
  if (eventType === 'agent.exited') {
    // Intentional stop (desiredState === 'stopped') → grey OFFLINE
    // Crash (desiredState === 'running' or undefined) → red OFFLINE (ERROR)
    const isIntentional = desiredState === 'stopped';
    return isIntentional
      ? { label: 'OFFLINE', variant: 'offline' }
      : { label: 'OFFLINE (ERROR)', variant: 'error' };
  }

  if (eventType === 'agent.circuitOpen') {
    return { label: 'OFFLINE (ERROR)', variant: 'error' };
  }

  // ── Online events ──────────────────────────────────────────────────────────

  if (eventType === 'agent.registered') {
    return { label: 'REGISTERED', variant: 'transitioning' };
  }

  if (eventType === 'agent.waiting') {
    // If stop was requested but the agent hasn't exited yet, show STOPPING
    if (desiredState === 'stopped') {
      return { label: 'STOPPING', variant: 'transitioning' };
    }
    return { label: 'WAITING', variant: 'ready' };
  }

  if (eventType === 'agent.requestStart' || eventType === 'agent.started') {
    // Merge both into STARTING — both mean "coming online soon"
    return { label: 'STARTING', variant: 'transitioning' };
  }

  if (eventType === 'agent.requestStop') {
    return { label: 'STOPPING', variant: 'transitioning' };
  }

  if (eventType === 'task.acknowledged') {
    return { label: 'TASK RECEIVED', variant: 'ready' };
  }

  if (eventType === 'task.inProgress' || eventType === 'task.completed') {
    // Both show WORKING: completed is momentary before returning to WAITING
    return { label: 'WORKING', variant: 'working' };
  }

  // NOTE: task.activated is intentionally NOT mapped here. It fires at task
  // creation (pending status) before any agent claims the task, so mapping it
  // to "TASK RECEIVED" would be misleading. Only task.acknowledged (which fires
  // when an agent actually claims a task) should show "TASK RECEIVED".

  // ── Fallback ───────────────────────────────────────────────────────────────
  return { label: 'ONLINE', variant: 'ready' };
}
