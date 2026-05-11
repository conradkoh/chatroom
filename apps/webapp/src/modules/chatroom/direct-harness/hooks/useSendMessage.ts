'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type {
  HarnessSendMessageInput,
  HarnessSendMessageResult,
} from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type { HarnessSendMessageInput, HarnessSendMessageResult };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSendMessage(): {
  send: (input: HarnessSendMessageInput) => Promise<HarnessSendMessageResult>;
  isSending: boolean;
} {
  const [isSending, setIsSending] = useState(false);
  const sendMutation = useSessionMutation(api.web.directHarness.messages.send);

  const send = async (input: HarnessSendMessageInput): Promise<HarnessSendMessageResult> => {
    setIsSending(true);
    try {
      const result = await sendMutation({
        harnessSessionId: input.harnessSessionId,
        text: input.text,
      });
      return result;
    } finally {
      setIsSending(false);
    }
  };

  return { send, isSending };
}
