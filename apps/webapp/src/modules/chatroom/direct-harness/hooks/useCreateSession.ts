'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessCreateSessionInput {
  workspaceId: Id<'chatroom_workspaces'>;
  harnessName: string;
  config: {
    agent: string;
    model?: { providerID: string; modelID: string };
    system?: string;
    tools?: Record<string, boolean>;
  };
  firstMessage: string;
}

export interface HarnessCreateSessionResult {
  harnessSessionId: Id<'chatroom_harnessSessions'>;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCreateSession(): {
  create: (input: CreateSessionInput) => Promise<CreateSessionResult>;
  isCreating: boolean;
} {
  // TODO: implement
  throw new Error('Not implemented');
}
