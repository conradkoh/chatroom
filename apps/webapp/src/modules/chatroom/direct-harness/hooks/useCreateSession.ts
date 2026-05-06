'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useState } from 'react';

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
  create: (input: HarnessCreateSessionInput) => Promise<HarnessCreateSessionResult>;
  isCreating: boolean;
} {
  const [isCreating, setIsCreating] = useState(false);
  const createMutation = useSessionMutation(api.web.directHarness.sessions.create);

  const create = async (input: HarnessCreateSessionInput): Promise<HarnessCreateSessionResult> => {
    setIsCreating(true);
    try {
      const result = await createMutation({
        workspaceId: input.workspaceId,
        harnessName: input.harnessName,
        config: input.config,
        firstMessage: input.firstMessage,
      });
      return { harnessSessionId: result.sessionId };
    } finally {
      setIsCreating(false);
    }
  };

  return { create, isCreating };
}
