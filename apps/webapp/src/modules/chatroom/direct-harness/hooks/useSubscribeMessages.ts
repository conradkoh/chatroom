'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessMessage {
  _id: string;
  _creationTime: number;
  harnessSessionId: Id<'chatroom_harnessSessions'>;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface HarnessSubscribeInput {
  harnessSessionId: Id<'chatroom_harnessSessions'>;
  afterSeq?: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSubscribeMessages(
  input: UseSubscribeMessagesInput
): Message[] | undefined {
  // TODO: implement
  throw new Error('Not implemented');
}
