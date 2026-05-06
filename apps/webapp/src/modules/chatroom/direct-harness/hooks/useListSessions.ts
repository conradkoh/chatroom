'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessSessionSummary {
  _id: Id<'chatroom_harnessSessions'>;
  status: string;
  harnessName: string;
  sessionTitle?: string;
  lastUsedConfig: { agent: string };
  workspaceId: Id<'chatroom_workspaces'>;
  createdAt: number;
  lastActiveAt: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useListSessions(
  workspaceId: Id<'chatroom_workspaces'> | null
): HarnessSessionSummary[] | undefined {
  // TODO: implement
  throw new Error('Not implemented');
}
