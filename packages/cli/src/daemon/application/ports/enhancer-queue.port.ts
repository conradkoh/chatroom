export type EnhancerQueueJobStatus = 'pending' | 'claimed' | 'running' | 'complete' | 'failed';

export type EnhancerQueueJobPayload = {
  agentHarness: string;
  model: string;
  machineId: string;
  originUserMessageId?: string;
  /** Handoff content used to render the local task envelope. */
  content?: string;
  /** Resolved workspace working dir (falls back to machine cwd at spawn). */
  workingDir?: string;
};

export type EnhancerQueueJob = {
  jobId: string;
  chatroomId: string;
  machineId: string;
  status: EnhancerQueueJobStatus;
  payload: EnhancerQueueJobPayload;
  createdAt: number;
  updatedAt: number;
};

export type EnqueueEnhancerQueueInput = {
  jobId: string;
  chatroomId: string;
  machineId: string;
  payload: EnhancerQueueJobPayload;
};

export interface EnhancerQueuePort {
  enqueue(input: EnqueueEnhancerQueueInput): void;
  claimPendingForMachine(machineId: string): EnhancerQueueJob | null;
  listPendingForMachine(machineId: string): EnhancerQueueJob[];
  markComplete(jobId: string): void;
  markFailed(jobId: string, error?: string): void;
}
