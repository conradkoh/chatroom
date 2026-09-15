import type {
  AssignedTask,
  AssignedTaskWithContent,
} from '../../../../domain/entities/assigned-task.js';
import type { AgentProcessSlotView } from '../../../agent-process-service/index.js';
import type { AgentConfigEntry } from '../../../chatroom-workspace-configuration-service/index.js';
import type { DeliveryBlockReason } from '../../domain/usecase/native-delivery-reason.js';

export interface TaskDeliveryService {
  isNativeHarness(harness: string): boolean;
  taskRequestsNativeColdSession(task: AssignedTask): boolean;
  explainNativeDeliveryBlock(
    task: AssignedTask,
    options: {
      slot: AgentProcessSlotView | undefined;
      agentConfig: AgentConfigEntry | undefined;
    }
  ): DeliveryBlockReason | null;
  releaseTaskAfterTurnFailure(args: { chatroomId: string; role: string; taskId: string }): Promise<{
    released: boolean;
    status: AssignedTask['status'];
    updatedAt: number;
  }>;
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
