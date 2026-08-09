import type { OutboundEvent } from '../../../domain/entities/outbound-event.js';
// fallow-ignore-file unused-file
import { buildTurnEndedEvent } from '../../../domain/events/agent-lifecycle.js';

export interface HandleTurnEndInput {
  chatroomId: string;
  role: string;
  taskId?: string;
  /** Locally-derived proxy for Convex `handleNativeAgentEnd` in-progress-work check. */
  hasInFlightWork: boolean;
}

export interface HandleTurnEndDeps {
  machineId: string;
  appendLifecycleEvent: (event: OutboundEvent) => void;
  /** Inject the missed-handoff reminder into the harness — no Convex round-trip. */
  injectHandoffReminder: (chatroomId: string, role: string) => void;
  now?: () => number;
}

export interface HandleTurnEndResult {
  reminderScheduled: boolean;
}

/**
 * Local missed-handoff reminder scheduling for native turn-end.
 * Appends a local `turn.ended` fact and injects the reminder when in-flight
 * work remains, avoiding a Convex round-trip for the reminder decision.
 */
export function handleTurnEnd(
  deps: HandleTurnEndDeps,
  input: HandleTurnEndInput
): HandleTurnEndResult {
  const timestamp = deps.now?.() ?? Date.now();
  deps.appendLifecycleEvent(
    buildTurnEndedEvent({
      chatroomId: input.chatroomId,
      role: input.role,
      machineId: deps.machineId,
      taskId: input.taskId,
      timestamp,
    })
  );

  if (!input.hasInFlightWork) {
    return { reminderScheduled: false };
  }

  deps.injectHandoffReminder(input.chatroomId, input.role);
  return { reminderScheduled: true };
}
