'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';

import { useEnhancerConfig } from './useEnhancerConfig';

export function useActiveEnhancerJob(chatroomId: string) {
  const [isDisabling, setIsDisabling] = useState(false);
  const activeJob = useSessionQuery(api.web.enhancer.index.getActiveJob, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });
  const cancelMutation = useSessionMutation(api.web.enhancer.index.cancelActiveJob);
  const { disable } = useEnhancerConfig(chatroomId);

  const disableEnhancer = useCallback(async () => {
    if (isDisabling) return;
    setIsDisabling(true);
    try {
      if (activeJob?.jobId) {
        await cancelMutation({
          chatroomId: chatroomId as Id<'chatroom_rooms'>,
          jobId: activeJob.jobId,
        });
      }
      await disable();
    } finally {
      setIsDisabling(false);
    }
  }, [activeJob?.jobId, cancelMutation, chatroomId, disable, isDisabling]);

  return {
    activeJob: activeJob ?? null,
    isEnhancing: activeJob != null,
    disableEnhancer,
    isDisabling,
  };
}
