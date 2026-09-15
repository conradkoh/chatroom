import type { DeliveryBlockReason } from './native-delivery-reason.js';
import type { AssignedTask } from '../../../../domain/entities/assigned-task.js';

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
  return null;
}
