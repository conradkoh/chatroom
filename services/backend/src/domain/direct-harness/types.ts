/**
 * Shared domain types for the direct-harness system.
 *
 * These types are used across CLi daemon, frontend, and backend Convex
 * endpoints. They sit outside the convex/ directory because they are not
 * Convex mutations/queries — they define the shared contract between
 * the three consumers.
 */

import type { Id } from '../../../convex/_generated/dataModel';

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
  _id: Id<'chatroom_harnessSessionMessages'>;
  _creationTime: number;
  harnessSessionId: Id<'chatroom_harnessSessions'>;
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
  _id: Id<'chatroom_harnessSessions'>;
  status: HarnessSessionStatus;
  harnessName: string;
  sessionTitle?: string;
  lastUsedConfig: HarnessConfig;
  workspaceId: Id<'chatroom_workspaces'>;
  createdAt: number;
  lastActiveAt: number;
}

// ─── Create session ───────────────────────────────────────────────────────────

export interface HarnessCreateInput {
  workspaceId: Id<'chatroom_workspaces'>;
  harnessName: string;
  config: HarnessConfig;
  firstMessage: string;
}

export interface HarnessCreateResult {
  harnessSessionId: Id<'chatroom_harnessSessions'>;
}

// ─── Send message ─────────────────────────────────────────────────────────────

export interface HarnessSendMessageInput {
  harnessSessionId: Id<'chatroom_harnessSessions'>;
  text: string;
}

export interface HarnessSendMessageResult {
  seq: number;
}

// ─── Direct-Harness Commands ────────────────────────────────────────────────

/** Discriminated union of all direct-harness command types. */
export type DirectHarnessCommandType = 'refreshCapabilities';

/** Payload for a refreshCapabilities command. */
export interface DirectHarnessRefreshCapabilitiesPayload {
  initiatedBy: string;
}

/**
 * A command issued by the web UI for the daemon to execute.
 *
 * Uses a tagged-union pattern: `type` discriminates the command kind, and
 * a field matching the type name holds the type-specific payload (e.g.
 * when type is 'refreshCapabilities', `refreshCapabilities` is the payload).
 * This keeps the schema extensible — new types add a new optional field.
 */
export interface DirectHarnessCommand {
  _id: Id<'chatroom_directHarnessCommands'>;
  _creationTime: number;
  machineId: string;
  workspaceId: Id<'chatroom_workspaces'>;
  type: DirectHarnessCommandType;
  refreshCapabilities?: DirectHarnessRefreshCapabilitiesPayload;
  status: 'pending' | 'inProgress' | 'done' | 'failed';
  createdAt: number;
  completedAt?: number;
  errorMessage?: string;
}
