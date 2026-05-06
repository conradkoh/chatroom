'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessCapability {
  name: string;
  displayName: string;
  agents: Array<{
    name: string;
    mode: 'subagent' | 'primary' | 'all';
    model?: { providerID: string; modelID: string };
    description?: string;
  }>;
  providers: Array<{
    providerID: string;
    name: string;
    models: Array<{ modelID: string; name: string }>;
  }>;
}

export interface HarnessWorkspaceCapabilities {
  harnesses: HarnessCapability[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWorkspaceCapabilities(
  workspaceId: Id<'chatroom_workspaces'> | null
): WorkspaceCapabilities | undefined {
  // TODO: implement
  throw new Error('Not implemented');
}
