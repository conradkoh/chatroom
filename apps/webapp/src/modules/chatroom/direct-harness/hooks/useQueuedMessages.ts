'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import type { QueuedMessage } from '@workspace/backend/src/domain/direct-harness/types';
import { useSessionQuery } from 'convex-helpers/react/sessions';

export type { QueuedMessage };

export function useQueuedMessages(
  harnessSessionId: Id<'chatroom_harnessSessions'>
): QueuedMessage[] | undefined {
  return useSessionQuery(api.web.directHarness.messageQueue.subscribe, {
    harnessSessionId,
  });
}
