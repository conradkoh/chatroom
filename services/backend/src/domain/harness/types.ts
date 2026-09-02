// fallow-ignore-file code-duplication
/** Shared harness configuration, turn-view, and capability contracts. */

import type { Id } from '../../../convex/_generated/dataModel';

// fallow-ignore-next-line unused-type
export interface HarnessConfig {
  agent: string;
  model?: { providerID: string; modelID: string } | undefined;
  system?: string | undefined;
  tools?: Record<string, boolean> | undefined;
}

/** Wire shape returned by agentic-query turn endpoints. */
export interface HarnessTurnView {
  _id: Id<'chatroom_agenticQueryRunTurns'>;
  turnSeq: number;
  role: 'user' | 'assistant';
  status: 'pending' | 'streaming' | 'complete' | 'failed';
  messageId?: string | undefined;
  textContent: string;
  reasoningContent: string;
  startedAt: number;
  completedAt?: number | undefined;
}

/** A streamed agentic-query output chunk. */
export interface HarnessMessage {
  _id: Id<'chatroom_agenticQueryRunMessages'>;
  _creationTime: number;
  runId: Id<'chatroom_agenticQueryRuns'>;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  messageId?: string | undefined;
  partType?: 'text' | 'reasoning' | undefined;
}

export interface HarnessAgent {
  name: string;
  mode: 'subagent' | 'primary' | 'all';
  model?: { providerID: string; modelID: string } | undefined;
  description?: string | undefined;
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
  configSchema?: unknown | undefined;
}

// fallow-ignore-next-line unused-type
export interface HarnessWorkspaceCapabilities {
  harnesses: HarnessCapability[];
}
