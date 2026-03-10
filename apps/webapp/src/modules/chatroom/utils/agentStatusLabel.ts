/**
 * Agent status label utilities — shared between useAgentStatuses.ts and InlineAgentCard.tsx.
 *
 * Full agent lifecycle (event type → label):
 *
 *   null/undefined    → IDLE         (never started; no events on record)
 *   agent.registered  → REGISTERED   (register-agent ran; hasn't started get-next-task yet)
 *   agent.waiting     → WAITING      (get-next-task subscription active; truly ready for tasks)
 *   agent.requestStart→ STARTING     (daemon/UI requested agent start)
 *   agent.started     → RUNNING      (agent process confirmed running)
 *   agent.requestStop → STOPPING     (stop requested; waiting for agent to exit)
 *   agent.exited      → STOPPED      (agent exited cleanly; shown offline)
 *   agent.circuitOpen → ERROR        (circuit breaker open; too many crash/restart cycles)
 *   task.acknowledged → TASK RECEIVED(agent claimed a task via get-next-task)
 *   task.inProgress   → WORKING      (agent called task-started; actively processing)
 *   task.completed    → COMPLETED    (task finished; agent about to return to WAITING)
 */

/**
 * Maps a chatroom_eventStream event type to a human-readable status label.
 * Used in both the hook and the card component — do NOT duplicate this function.
 */
export function eventTypeToStatusLabel(eventType: string | null | undefined): string {
  switch (eventType) {
    // ── Agent has never registered — not started ────────────────────────────
    case null:
    case undefined:
      return 'IDLE';

    // ── Agent lifecycle events ──────────────────────────────────────────────
    case 'agent.registered':
      // Agent registered (register-agent ran) but hasn't started get-next-task yet.
      // Distinguishable from WAITING: the subscription loop isn't active yet.
      return 'REGISTERED';
    case 'agent.waiting':
      // Subscription is active; agent is truly listening for incoming tasks.
      return 'WAITING';
    case 'agent.requestStart':
      return 'STARTING';
    case 'agent.started':
      return 'RUNNING';
    case 'agent.requestStop':
      // Stop was requested; agent is still alive but shutting down.
      return 'STOPPING';
    case 'agent.exited':
      // Agent exited cleanly. Shown with offline indicator.
      return 'STOPPED';
    case 'agent.circuitOpen':
      // Circuit breaker opened: too many crash/restart cycles.
      return 'ERROR';

    // ── Task lifecycle events ───────────────────────────────────────────────
    case 'task.acknowledged':
      // Agent claimed the task (pending → acknowledged). Work is imminent.
      return 'TASK RECEIVED';
    case 'task.activated':
      return 'ACTIVE';
    case 'task.inProgress':
      // Agent called task-started and is actively processing.
      return 'WORKING';
    case 'task.completed':
      // Task finished. Agent will return to WAITING momentarily.
      return 'COMPLETED';

    default:
      return 'ONLINE';
  }
}

/**
 * Derives a user-facing status label from event type and online state.
 *
 * Offline rules (shown with grey indicator):
 *   - null/undefined (never registered) → "IDLE"    ← distinct from "STOPPED"
 *   - agent.exited                       → "STOPPED" ← clean exit
 *   - agent.circuitOpen                  → "ERROR"   ← circuit breaker tripped
 */
export function resolveStatusLabel(
  latestEventType: string | null,
  online: boolean
): string {
  if (!online) {
    // Offline state — distinguish between never-started, stopped, and error
    if (latestEventType === null || latestEventType === undefined) {
      return 'IDLE'; // Never registered — not started
    }
    if (latestEventType === 'agent.exited') {
      return 'STOPPED'; // Clean exit
    }
    if (latestEventType === 'agent.circuitOpen') {
      return 'ERROR'; // Circuit breaker tripped
    }
    return 'OFFLINE'; // Fallback for other offline states
  }

  return eventTypeToStatusLabel(latestEventType);
}
