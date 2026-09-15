import type { DeliveryBlockReason } from './native-delivery-reason.js';
import type { AssignedTask } from '../../../../domain/entities/assigned-task.js';
import { isChatroomStopScopeActive } from '../../../agent-process-contracts.js';

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
 * - Stop-scope guards apply before any cold start.
 */

/**
 * Explicit cold-session intent is distinct from role-default augmentation.
 * Only an explicit `sessionPolicy: 'new'` / `startInNewSession` task may own
 * a delivery cold start.
 */
export function taskRequestsNativeColdSession(task: AssignedTask): boolean {
  return task.requestsNativeColdSession === true;
}

// fallow-ignore-next-line complexity
export function explainColdSessionDeliveryBlock(task: AssignedTask): DeliveryBlockReason | null {
  if (!taskRequestsNativeColdSession(task)) return null;
  if (isChatroomStopScopeActive(task.chatroomId)) {
    return 'chatroom_stop_scope_active';
  }
  return null;
}
