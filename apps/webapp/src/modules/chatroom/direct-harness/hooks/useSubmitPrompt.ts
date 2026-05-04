'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseSubmitPromptArgs {
  harnessSessionRowId: Id<'chatroom_harnessSessions'>;
}

interface SubmitPromptInput {
  parts: { type: 'text'; text: string }[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSubmitPrompt({ harnessSessionRowId }: UseSubmitPromptArgs): {
  submit: (input: SubmitPromptInput) => Promise<void>;
  isSubmitting: boolean;
} {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const session = useSessionQuery(api.chatroom.directHarness.sessions.getSession, {
    harnessSessionRowId,
  });

  const submitPromptMutation = useSessionMutation(api.chatroom.directHarness.prompts.submitPrompt);

  const submit = async ({ parts }: SubmitPromptInput): Promise<void> => {
    const lastUsedConfig = session?.lastUsedConfig;
    if (lastUsedConfig === undefined) {
      throw new Error(
        'useSubmitPrompt: session.lastUsedConfig is undefined — cannot submit without a config override.'
      );
    }

    setIsSubmitting(true);
    try {
      await submitPromptMutation({
        harnessSessionRowId,
        parts,
        override: lastUsedConfig,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return { submit, isSubmitting };
}
