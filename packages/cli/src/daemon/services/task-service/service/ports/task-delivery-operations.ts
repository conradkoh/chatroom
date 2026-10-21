import type { TaskDeliveryFailureReason } from './native-task-delivery.js';
import type {
  AssignedTask,
  AssignedTaskWithContent,
} from '../../../../domain/entities/assigned-task.js';
import type { UncoveredTurnDecision } from '../../domain/usecase/uncovered-turn-ladder.js';

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
  /** Counts a provider failure; `attempts` is 1-based, `exceeded` stops release/redelivery. */
  recordTurnFailure(args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<{ attempts: number; exceeded: boolean }>;
  /** Next ladder step for a completed turn with no covering handoff. Parks when exhausted. */
  decideUncoveredTurnEnd(args: {
    chatroomId: string;
    role: string;
    taskId: string;
    sessionKey: string;
    nudgeUnavailable?: boolean;
  }): Promise<UncoveredTurnDecision>;
  /** Records that a nudge was delivered in this session. */
  confirmNudgeSent(args: {
    chatroomId: string;
    role: string;
    taskId: string;
    sessionKey: string;
  }): void;
  /** Clears ladder and failure counters after a covered turn end. The parked marker is kept. */
  resetTurnTracking(args: { chatroomId: string; role: string; taskId: string }): void;
  isRedeliveryExhausted(args: { chatroomId: string; role: string; taskId: string }): boolean;
  clearRedeliveryTracking(args: { chatroomId: string; role: string }): void;
  /** Evicts a task proven absent from the authoritative backend. */
  forgetStaleTask(args: { chatroomId: string; role: string; taskId: string }): void;
  loadAssignedTaskForAction(args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<AssignedTaskWithContent | null>;
}
