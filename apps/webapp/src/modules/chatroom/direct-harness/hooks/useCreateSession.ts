'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type {
  HarnessCreateInput,
  HarnessCreateResult,
} from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

// All types imported from @workspace/backend.
// Narrow Id types for this specific context.
export type { HarnessCreateInput, HarnessCreateResult };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useCreateSession(): {
  create: (input: HarnessCreateInput) => Promise<HarnessCreateResult>;
  isCreating: boolean;
} {
  const [isCreating, setIsCreating] = useState(false);
  const createMutation = useSessionMutation(api.web.directHarness.sessions.create);

  const create = async (input: HarnessCreateInput): Promise<HarnessCreateResult> => {
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
