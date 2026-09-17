import type { TaskDeliveryFailureReason } from './native-task-delivery.js';
import type {
  AssignedTask,
  AssignedTaskWithContent,
} from '../../../../domain/entities/assigned-task.js';

/**
 * Delivery-side task operations shared by the full `TaskService` and the
 * narrow `TaskDeliveryService` slice consumed by the native delivery path.
 * Both interfaces extend this contract so the method shapes live in one place.
 */
export interface TaskDeliveryOperations {
  releaseTaskAfterTurnFailure(args: { chatroomId: string; role: string; taskId: string }): Promise<{
    released: boolean;
    status: AssignedTask['status'];
    updatedAt: number;
  }>;
  recordDeliveryFailure(args: {
    taskId: string;
    reason: TaskDeliveryFailureReason;
  }): Promise<boolean>;
  clearDeliveryFailure(
    taskId: string,
    expectedReason?: TaskDeliveryFailureReason
  ): Promise<boolean>;
  /** Plan V2: counts an uncovered turn end; `exceeded` stops release/redelivery. */
  recordUncoveredTurnEnd(args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<{ exceeded: boolean }>;
  isRedeliveryExhausted(args: { chatroomId: string; role: string; taskId: string }): boolean;
  clearRedeliveryTracking(args: { chatroomId: string; role: string }): void;
  loadAssignedTaskForAction(args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<AssignedTaskWithContent | null>;
}
