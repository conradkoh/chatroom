import type {
  AssignedTask,
  AssignedTaskWithContent,
} from '../../../../domain/entities/assigned-task.js';
import type { DeliveryBlockReason } from '../../domain/usecase/native-delivery-reason.js';
import type { TaskDeliveryFailureReason } from '../ports/native-task-delivery.js';

export interface TaskDeliveryService {
  isNativeHarness(harness: string): boolean;
  explainNativeDeliveryBlock(task: AssignedTask): DeliveryBlockReason | null;
  releaseTaskAfterTurnFailure(args: { chatroomId: string; role: string; taskId: string }): Promise<{
    released: boolean;
    status: AssignedTask['status'];
    updatedAt: number;
  }>;
  recordDeliveryFailure(args: {
    taskId: string;
    reason:
      | 'no_agent_config'
      | 'unsupported_harness'
      | 'injection_not_confirmed'
      | 'task_not_deliverable'
      | 'assigned_elsewhere';
  }): Promise<boolean>;
  clearDeliveryFailure(
    taskId: string,
    expectedReason?: TaskDeliveryFailureReason
  ): Promise<boolean>;
  loadAssignedTaskForAction(args: {
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<AssignedTaskWithContent | null>;
  deliverNativeTask(
    task: AssignedTaskWithContent,
    harnessSessionId: string | undefined,
    onTaskDelivered?: (args: {
      chatroomId: string;
      role: string;
      taskId: string;
      harnessSessionId: string;
    }) => void
  ): Promise<void>;
}
