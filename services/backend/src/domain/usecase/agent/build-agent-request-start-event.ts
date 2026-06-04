/**
 * Single source of truth for the shape of an `agent.requestStart` event.
 *
 * Two call sites emit this event — the start-agent use case (manual/user start)
 * and the auto-restart-on-new-context use case. Hand-copying the field set
 * between them invites drift: a field added in one place can be silently
 * forgotten in the other (this is exactly what nearly happened with
 * `wantResume`). Routing both through this constructor makes the field set
 * impossible to drop accidentally.
 *
 * Type-safety choices:
 * - `wantResume` is a REQUIRED `boolean`. The "absent ⇒ default true" decision
 *   is resolved by the caller BEFORE building the event, so by the time we are
 *   here the value is always concrete. A caller that forgets it is a compile
 *   error.
 * - `autoRestartOnNewContext` is `boolean | undefined` — a REQUIRED key whose
 *   value may be undefined. This forces every caller to make a conscious
 *   decision (pass the snapshot, or explicitly `undefined`) rather than be able
 *   to omit the key entirely.
 */

import { AGENT_REQUEST_DEADLINE_MS } from '../../../../config/reliability';
import type { Id } from '../../../../convex/_generated/dataModel';
import type { AgentHarness } from '../../entities/agent';

/** Fully-resolved inputs for an `agent.requestStart` event. No optional keys. */
export interface AgentRequestStartEventInput {
  chatroomId: Id<'chatroom_rooms'>;
  machineId: string;
  role: string;
  agentHarness: AgentHarness;
  model: string;
  workingDir: string;
  reason: string;
  /** Resolved resume preference (default already applied by the caller). */
  wantResume: boolean;
  /**
   * Snapshot of the team config's auto-restart flag at emit time (observability
   * only). Required key — pass the value or an explicit `undefined`.
   */
  autoRestartOnNewContext: boolean | undefined;
}

/**
 * The exact document inserted into `chatroom_eventStream` for a start request.
 * Computes the deadline from {@link AGENT_REQUEST_DEADLINE_MS} so callers cannot
 * forget it or use an inconsistent window.
 */
export function buildAgentRequestStartEvent(input: AgentRequestStartEventInput, now: number) {
  return {
    type: 'agent.requestStart' as const,
    chatroomId: input.chatroomId,
    machineId: input.machineId,
    role: input.role,
    agentHarness: input.agentHarness,
    model: input.model,
    workingDir: input.workingDir,
    reason: input.reason,
    deadline: now + AGENT_REQUEST_DEADLINE_MS,
    timestamp: now,
    wantResume: input.wantResume,
    // Keep the key absent (rather than `undefined`) when not provided, matching
    // the optional schema validator and avoiding undefined writes.
    ...(input.autoRestartOnNewContext !== undefined
      ? { autoRestartOnNewContext: input.autoRestartOnNewContext }
      : {}),
  };
}
