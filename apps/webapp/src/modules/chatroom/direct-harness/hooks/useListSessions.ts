'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessSessionStatus, HarnessSessionSummary } from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionQuery } from 'convex-helpers/react/sessions';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { HarnessSessionStatus, HarnessSessionSummary };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useListSessions(
  workspaceId: Id<'chatroom_workspaces'> | null
): HarnessSessionSummary[] | undefined {
  return useSessionQuery(
    api.web.directHarness.sessions.listSessions,
    workspaceId ? { workspaceId } : 'skip'
  );
}
