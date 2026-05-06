'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';

// ─── Types ────────────────────────────────────────────────────────────────────

export type HarnessSessionStatus = 'pending' | 'spawning' | 'active' | 'idle' | 'closed' | 'failed';

export interface HarnessSessionSummary {
  _id: Id<'chatroom_harnessSessions'>;
  status: HarnessSessionStatus;
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
  return useSessionQuery(
    api.web.directHarness.sessions.listSessions,
    workspaceId ? { workspaceId } : 'skip'
  );
}
