import type {
  AssignedTask,
  AssignedTaskWithContent,
} from '../../../../domain/entities/assigned-task.js';
import type { AgentProcessSlotView } from '../../../agent-process-contracts.js';
import type { WorkspaceTaskInboxEvent } from '../task-service.js';

export type TaskDeliveryFailureReason =
  | 'no_agent_config'
  | 'unsupported_harness'
  | 'injection_not_confirmed'
  | 'task_not_deliverable'
  | 'assigned_elsewhere';

export interface NativeTaskDeliveryGateway {
  recordDeliveryFailure(args: {
    sessionId: string;
    machineId: string;
    taskId: string;
    reason: TaskDeliveryFailureReason;
  }): Promise<boolean>;
  clearDeliveryFailure(args: {
    sessionId: string;
    machineId: string;
    taskId: string;
  }): Promise<boolean>;
  listActiveTaskStatuses(args: {
    sessionId: string;
    machineId: string;
  }): Promise<readonly AssignedTask[]>;
  listPendingTaskInboxEvents(args: {
    sessionId: string;
    machineId: string;
  }): Promise<readonly WorkspaceTaskInboxEvent[]>;
  markTaskInboxEventProcessed(args: {
    sessionId: string;
    machineId: string;
    eventId: string;
  }): Promise<boolean>;
  claimPendingTask(args: {
    sessionId: string;
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<void>;
  /**
   * Requests the backend to release a single in-flight task back to pending
   * after a native turn failure. Scoped to the exact task/role; idempotent
   * for already-pending/completed tasks.
   */
  releaseTaskAfterTurnFailure(args: {
    sessionId: string;
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<{
    released: boolean;
    status: AssignedTask['status'];
    updatedAt: number;
  }>;
  loadDeliveryPrompt(args: {
    sessionId: string;
    chatroomId: string;
    role: string;
    taskId: string;
    convexUrl?: string;
  }): Promise<{ fullCliOutput: string }>;
  recordReceipt(args: {
    sessionId: string;
    chatroomId: string;
    role: string;
    taskId: string;
    harnessSessionId: string;
  }): Promise<void>;
  joinWaitingParticipant(args: {
    sessionId: string;
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<void>;
  recordSessionAugmentation(args: {
    sessionId: string;
    machineId: string;
    chatroomId: string;
    role: string;
    taskId: string;
    mode: string;
    newSessionStarted: boolean;
    harnessSessionId: string;
  }): Promise<void>;
  loadAssignedTaskForAction(args: {
    sessionId: string;
    machineId: string;
    taskId: string;
    role: string;
  }): Promise<AssignedTaskWithContent | null>;
}

export interface NativeTaskDeliveryAuditPort {
  emit(event: Record<string, unknown>): Promise<void>;
}

export interface NativeTaskDeliveryAgentPort {
  resumeTurnForSlot(args: { chatroomId: string; role: string; prompt: string }): Promise<void>;
  getSlot(chatroomId: string, role: string): AgentProcessSlotView | undefined;
}
