/** CLI-owned harness shared types — mirrors backend wire shapes without importing backend. */

export type HarnessSessionStatus = 'pending' | 'spawning' | 'active' | 'idle' | 'closed' | 'failed';

export interface HarnessAgent {
  name: string;
  mode: 'subagent' | 'primary' | 'all';
  model?: { providerID: string; modelID: string };
  description?: string;
}

export interface HarnessProvider {
  providerID: string;
  name: string;
  models: { modelID: string; name: string }[];
}

export interface HarnessCapability {
  name: string;
  displayName: string;
  agents: HarnessAgent[];
  providers: HarnessProvider[];
  configSchema?: unknown;
}

/** Known agent harness identifiers used by the daemon. */
export type AgentHarness = string;

/** Upper bound on Codex SDK `modelReasoningEffort` (excludes harness `none`). */
export type MaxReasoningLevel = 'low' | 'medium' | 'high' | 'xhigh';
