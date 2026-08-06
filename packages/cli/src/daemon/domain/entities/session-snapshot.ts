import type { HarnessSessionIdPair } from './harness-session-id-pair.js';
import type { AgentHarness } from './harness-shared-types.js';

/**
 * Daemon-memory harness session context for stop→start or crash reconnect.
 * Lost when the daemon process restarts.
 */
export interface HarnessSessionSnapshot extends HarnessSessionIdPair {
  harness: AgentHarness;
  agentName: string;
  workingDir: string;
  model?: string;
}
