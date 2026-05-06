'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessMessage {
  _id: Id<'chatroom_harnessSessions'>;
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
  input: HarnessSubscribeInput
): HarnessMessage[] | undefined {
  return useSessionQuery(api.web.directHarness.messages.subscribe, {
    harnessSessionRowId: input.harnessSessionId,
    afterSeq: input.afterSeq,
  });
}
