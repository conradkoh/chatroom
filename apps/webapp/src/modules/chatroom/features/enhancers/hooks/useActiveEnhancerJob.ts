'use client';

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';

/**
 * Job-only enhancer hook: exposes the active planner→enhancer job and a
 * cancel action. Disabling enhancement is a separate concern (config-level,
 * next-message only) and must NOT cancel the in-flight job.
 */
export function useActiveEnhancerJob(chatroomId: string) {
  const [isCancelling, setIsCancelling] = useState(false);
  const activeJob = useSessionQuery(api.web.enhancer.index.getActiveJob, {
    chatroomId: chatroomId as Id<'chatroom_rooms'>,
  });
  const cancelMutation = useSessionMutation(api.web.enhancer.index.cancelActiveJob);

  const cancelJob = useCallback(async () => {
    if (!activeJob || isCancelling) return;
    setIsCancelling(true);
    try {
      await cancelMutation({
        chatroomId: chatroomId as Id<'chatroom_rooms'>,
        jobId: activeJob.jobId,
      });
    } catch (error) {
      reportCancelFailure(error);
    } finally {
      setIsCancelling(false);
    }
  }, [activeJob, cancelMutation, chatroomId, isCancelling]);

  return {
    activeJob: activeJob ?? null,
    isEnhancing: activeJob != null,
    cancelJob,
    isCancelling,
  };
}

function reportCancelFailure(error: unknown): void {
  console.error('Failed to cancel enhancer job:', error);
  toast.error(error instanceof Error ? error.message : 'Failed to cancel planning review');
}
