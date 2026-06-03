import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent';

/**
 * Daemon-memory harness session context for stop→start or crash reconnect.
 * Lost when the daemon process restarts.
 */
export interface HarnessSessionSnapshot {
  harnessSessionId: string;
  harness: AgentHarness;
  agentName: string;
  workingDir: string;
  model?: string;
}
