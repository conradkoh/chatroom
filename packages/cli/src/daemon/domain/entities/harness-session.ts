import type { HarnessSessionStatus } from './harness-shared-types.js';
import type { WorkspaceId } from './workspace.js';

/** Convex document ID for a chatroom_harnessSessions row. */
export type HarnessSessionId = string & { readonly __brand: 'HarnessSessionId' };

/** Session ID assigned by the OpenCode SDK server. */
export type OpenCodeSessionId = string & { readonly __brand: 'OpenCodeSessionId' };

export interface HarnessSession {
  readonly harnessSessionId: HarnessSessionId;
  readonly workspaceId: WorkspaceId;
  readonly opencodeSessionId?: OpenCodeSessionId;
  readonly agent: string;
  readonly status: HarnessSessionStatus;
  readonly lastActiveAt: number;
  readonly createdAt: number;
  readonly createdBy: string;
}
