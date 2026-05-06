'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';

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
  send: (input: SendMessageInput) => Promise<SendMessageResult>;
  isSending: boolean;
} {
  // TODO: implement
  throw new Error('Not implemented');
}
