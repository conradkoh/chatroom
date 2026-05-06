'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation } from 'convex-helpers/react/sessions';
import { useState } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessSendMessageInput {
  harnessSessionId: Id<'chatroom_harnessSessions'>;
  text: string;
}

export interface HarnessSendMessageResult {
  seq: number;
}

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
        harnessSessionRowId: input.harnessSessionId,
        text: input.text,
      });
      return { seq: result.seq };
    } finally {
      setIsSending(false);
    }
  };

  return { send, isSending };
}
