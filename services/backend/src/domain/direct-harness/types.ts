/**
 * Shared domain types for the direct-harness system.
 *
 * These types are used across CLi daemon, frontend, and backend Convex
 * endpoints. They sit outside the convex/ directory because they are not
 * Convex mutations/queries — they define the shared contract between
 * the three consumers.
 */

// ─── Session status ───────────────────────────────────────────────────────────

/** Canonical status union for harness sessions. */
export type HarnessSessionStatus =
  | 'pending'
  | 'spawning'
  | 'active'
  | 'idle'
  | 'closed'
  | 'failed';

// ─── Session config ───────────────────────────────────────────────────────────

/** Per-session config carried through the lifecycle. */
export interface HarnessConfig {
  agent: string;
  model?: { providerID: string; modelID: string };
  system?: string;
  tools?: Record<string, boolean>;
}

// ─── Messages ─────────────────────────────────────────────────────────────────

/** A single message in the harness session message stream. */
export interface HarnessMessage {
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

// ─── Capabilities ─────────────────────────────────────────────────────────────

/** Published agent definition from a harness. */
export interface HarnessAgent {
  name: string;
  mode: 'subagent' | 'primary' | 'all';
  model?: { providerID: string; modelID: string };
  description?: string;
}

/** Published provider (model provider) definition from a harness. */
export interface HarnessProvider {
  providerID: string;
  name: string;
  models: Array<{ modelID: string; name: string }>;
}

/** Published harness capability as seen in the machine registry. */
export interface HarnessCapability {
  name: string;
  displayName: string;
  agents: HarnessAgent[];
  providers: HarnessProvider[];
  configSchema?: unknown;
}

// ─── Workspace-level capabilities ─────────────────────────────────────────────

export interface HarnessWorkspaceCapabilities {
  harnesses: HarnessCapability[];
}

// ─── Session summary (list view) ──────────────────────────────────────────────

export interface HarnessSessionSummary {
  _id: string;
  status: HarnessSessionStatus;
  harnessName: string;
  sessionTitle?: string;
  lastUsedConfig: HarnessConfig;
  workspaceId: string;
  createdAt: number;
  lastActiveAt: number;
}

// ─── Create session ───────────────────────────────────────────────────────────

export interface HarnessCreateInput {
  workspaceId: string;
  harnessName: string;
  config: HarnessConfig;
  firstMessage: string;
}

export interface HarnessCreateResult {
  harnessSessionRowId: string;
}

// ─── Send message ─────────────────────────────────────────────────────────────

export interface HarnessSendMessageInput {
  harnessSessionId: string;
  text: string;
}

export interface HarnessSendMessageResult {
  seq: number;
}
