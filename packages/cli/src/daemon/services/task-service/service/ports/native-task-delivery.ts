import type { AgentKey, SerializedAgentOperations } from '../../../agent-process-service/index.js';
import type { AgentProcessSlotView } from '../../../agent-process-service/index.js';

export interface NativeTaskDeliveryGateway {
  claimPendingTask(args: {
    sessionId: string;
    chatroomId: string;
    role: string;
    taskId: string;
  }): Promise<void>;
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
}

export interface NativeTaskDeliveryAuditPort {
  emit(event: Record<string, unknown>): Promise<void>;
}

export interface NativeTaskDeliveryAgentPort {
  resumeTurnForSlot(args: { chatroomId: string; role: string; prompt: string }): Promise<void>;
  getSlot(chatroomId: string, role: string): AgentProcessSlotView | undefined;
}

export interface NativeTaskDeliverySerializationPort {
  runSerializedForAgent: <T>(
    key: AgentKey,
    options: { timeoutMs: number },
    operation: (ops: SerializedAgentOperations, context: { signal: AbortSignal }) => Promise<T>
  ) => Promise<T>;
}
