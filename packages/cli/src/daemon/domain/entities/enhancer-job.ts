export type EnhancerJobStatus =
  'pending' | 'claimed' | 'spawning' | 'running' | 'completed' | 'failed';

export interface EnhancerJob {
  jobId: string;
  chatroomId: string;
  agentHarness: string;
  model: string;
  workingDir: string;
  systemPrompt: string;
  taskEnvelope: string;
}

/** Pending row from pendingForMachine query (subset). */
export interface PendingEnhancerJob {
  jobId: string;
  chatroomId: string;
}
