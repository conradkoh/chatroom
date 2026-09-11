import type {
  AssignedTaskSnapshotView,
  AssignedTaskWithContent,
} from '../../../../domain/entities/assigned-task.js';
import type { AgentProcessSlotView } from '../../../agent-process-service/index.js';

export interface TaskDeliveryService {
  isNativeHarness(harness: string): boolean;
  snapshotRequestsNativeColdSession(task: AssignedTaskSnapshotView): boolean;
  explainNativeDeliveryBlock(
    task: AssignedTaskSnapshotView,
    options: { slot: AgentProcessSlotView | undefined }
  ): string | null;
  releaseTaskAfterTurnFailure(args: { chatroomId: string; role: string; taskId: string }): Promise<{
    released: boolean;
    status: AssignedTaskSnapshotView['status'];
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
