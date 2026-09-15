import { explainColdSessionDeliveryBlock } from './native-cold-session-delivery.js';
import type { DeliveryBlockReason } from './native-delivery-reason.js';
import type { AssignedTask } from '../../../../domain/entities/assigned-task.js';
import { isDeliverableTaskStatus } from '../../../../domain/entities/assigned-task.js';

/** Agent is ready for native task delivery (post-restart or steady-state). */
// fallow-ignore-next-line unused-export
export function isAgentReadyForNativeDelivery(task: AssignedTask): boolean {
  return explainAgentReadyForNativeDeliveryBlock(task) === null;
}

/** Stable reason when agent/slot is not ready; null when ready. */
// fallow-ignore-next-line complexity
export function explainAgentReadyForNativeDeliveryBlock(
  task: AssignedTask
): DeliveryBlockReason | null {
  return explainColdSessionDeliveryBlock(task);
}

/** Pending or acknowledged tasks eligible for (re)delivery when agent is ready. */
export function isDeliverableNativeTaskStatus(status: AssignedTask['status']): boolean {
  return isDeliverableTaskStatus(status);
}
