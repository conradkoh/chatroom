'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessWorkspaceCapabilities } from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionQuery } from 'convex-helpers/react/sessions';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { HarnessWorkspaceCapabilities };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWorkspaceCapabilities(
  workspaceId: Id<'chatroom_workspaces'> | null
): HarnessWorkspaceCapabilities | undefined {
  return useSessionQuery(
    api.web.directHarness.capabilities.listForWorkspace,
    workspaceId ? { workspaceId } : 'skip'
  );
}
