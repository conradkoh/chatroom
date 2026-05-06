'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { HarnessMessage } from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionQuery } from 'convex-helpers/react/sessions';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessSubscribeInput {
  harnessSessionId: Id<'chatroom_harnessSessions'>;
  afterSeq?: number;
}

export type { HarnessMessage };

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSubscribeMessages(
  input: HarnessSubscribeInput
): HarnessMessage[] | undefined {
  return useSessionQuery(api.web.directHarness.messages.subscribe, {
    harnessSessionRowId: input.harnessSessionId,
    afterSeq: input.afterSeq,
  });
}
