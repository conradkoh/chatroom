import type { AgentHarness } from '@workspace/backend/src/domain/entities/agent';

import type { HarnessSessionIdPair } from '../resolve-resumable-harness-session-id.js';

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
