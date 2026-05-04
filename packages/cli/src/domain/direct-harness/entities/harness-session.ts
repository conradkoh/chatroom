/**
 * Core domain types for a HarnessSession — one conversation turn with a harness
 * process. Sessions are associated with a Workspace and are switchable /
 * resumable across daemon restarts.
 */

import type { WorkspaceId } from './workspace.js';

/**
 * Opaque identifier for a harness session row in the backend.
 * This is the backend-issued row ID (replaces the old WorkerId brand).
 */
export type HarnessSessionRowId = string & { readonly __brand: 'HarnessSessionRowId' };

/**
 * Opaque identifier for a harness session as issued by the opencode server.
 * External and real — must be preserved across daemon restarts for resume().
 */
export type HarnessSessionId = string & { readonly __brand: 'HarnessSessionId' };

/** Lifecycle state of a harness session. */
export type HarnessSessionStatus =
  | 'pending'
  | 'spawning'
  | 'active'
  | 'idle'
  | 'closed'
  | 'failed';

/**
 * Represents a single harness session and its current state.
 *
 * A HarnessSession is created when `DirectHarnessSpawner.openSession()` is
 * called and tracks the lifecycle of one conversation with a harness process.
 */
export interface HarnessSession {
  /** Backend row identifier for this session. */
  readonly harnessSessionRowId: HarnessSessionRowId;
  /** The workspace this session belongs to. */
  readonly workspaceId: WorkspaceId;
  /** The opencode-server-issued session identifier (populated once spawning succeeds). */
  readonly harnessSessionId?: HarnessSessionId;
  /** The agent driving this session (e.g. 'builder', 'planner'). */
  readonly agent: string;
  readonly status: HarnessSessionStatus;
  readonly lastActiveAt: number;
  readonly createdAt: number;
  readonly createdBy: string;
}
