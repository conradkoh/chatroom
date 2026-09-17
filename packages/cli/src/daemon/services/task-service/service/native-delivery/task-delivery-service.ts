import type {
  AssignedTask,
  AssignedTaskWithContent,
} from '../../../../domain/entities/assigned-task.js';
import type { DeliveryBlockReason } from '../../domain/usecase/native-delivery-reason.js';
import type { TaskDeliveryOperations } from '../ports/task-delivery-operations.js';

export interface TaskDeliveryService extends TaskDeliveryOperations {
  isNativeHarness(harness: string): boolean;
  explainNativeDeliveryBlock(task: AssignedTask): DeliveryBlockReason | null;
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
