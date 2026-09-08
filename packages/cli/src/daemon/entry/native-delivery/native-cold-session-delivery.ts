import type { AssignedTaskSnapshotView } from '../../domain/entities/assigned-task.js';
import {
  isSlotIdle,
  isSlotSpawning,
  isSlotStopping,
} from '../../domain/usecase/check-agent-slot.js';
import {
  isOperationalCircuitOpen,
  isOperationalStopIntentActive,
} from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { MachineAgentOperationalRow } from '../../infrastructure/agent-operational/agent-operational-read-model.js';
import type { AgentSlot } from '../../services/agent-process-service/index.js';
import { isChatroomStopScopeActive } from '../../services/agent-process-service/index.js';

/**
 * Explicit cold-session intent is distinct from role-default augmentation.
 * Only an explicit `sessionPolicy: 'new'` / `startInNewSession` task may own
 * a delivery cold start.
 */
export function snapshotRequestsNativeColdSession(task: AssignedTaskSnapshotView): boolean {
  return task.requestsNativeColdSession === true;
}

/**
 * Cold-start eligible by local slot state alone: missing or idle.
 * Spawning and stopping are lifecycle transitions (wait); running is handled
 * by the normal ready gates plus the injector's cold-replacement step.
 */
// fallow-ignore-next-line unused-export
export function isColdStartEligibleSlotState(slot: AgentSlot | undefined): boolean {
  if (!slot) return true;
  return isSlotIdle(slot.state);
}

/** True when delivery's cold-session path should own the next spawn. */
export function isNativeColdSessionDeliveryOwnedSpawn(
  task: AssignedTaskSnapshotView,
  slot: AgentSlot | undefined
): boolean {
  return snapshotRequestsNativeColdSession(task) && isColdStartEligibleSlotState(slot);
}

/**
 * Block reason for an explicit cold-session task; null when delivery may
 * proceed (either via the cold down-slot path or via normal gates for a
 * running slot that the injector will cold-replace).
 *
 * Constraints:
 * - Spawning/stopping are transitions: wait for reconciliation instead of
 *   launching another operation. Expired stops are normalized via
 *   `clearStuckStoppingSlot` before owner selection; a still-present
 *   stopping slot blocks here.
 * - Stop-scope, operational stop intent, and circuit guards apply before any
 *   cold start.
 */
// fallow-ignore-next-line complexity
export function explainColdSessionDeliveryBlock(
  task: AssignedTaskSnapshotView,
  slot: AgentSlot | undefined,
  operational: MachineAgentOperationalRow | undefined
): string | null {
  if (!snapshotRequestsNativeColdSession(task)) return null;
  if (isChatroomStopScopeActive(task.chatroomId)) {
    return 'chatroom_stop_scope_active';
  }
  if (isOperationalStopIntentActive(operational)) {
    return 'operational_stop_intent_active';
  }
  if (isOperationalCircuitOpen(operational)) {
    return 'operational_circuit_open';
  }
  if (slot && isSlotSpawning(slot.state)) {
    return `slot_spawning (slotState=${slot.state})`;
  }
  if (slot && isSlotStopping(slot.state)) {
    return `slot_stopping (slotState=${slot.state})`;
  }
  return null;
}
