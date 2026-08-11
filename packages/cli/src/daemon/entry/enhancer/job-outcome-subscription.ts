import type { ConvexClient } from 'convex/browser';
import type { SessionId } from 'convex-helpers/server/sessions';

import { api } from '../../../api.js';
import type { Id } from '../../../api.js';

export type EnhancerJobStatus = 'pending' | 'running' | 'complete' | 'failed' | 'cancelled';

export interface EnhancerJobState {
  status: EnhancerJobStatus;
  attemptCount: number;
  maxAttempts: number;
  lastError?: string;
  runningSince?: number;
  nextRetryAt?: number;
  completedAt?: number;
}

export interface EnhancerJobOutcomeSubscription {
  readonly outcome: Promise<EnhancerJobState>;
  readonly getCurrentState: () => EnhancerJobState | null;
  stop: () => void;
}

/**
 * Adapts Convex's reactive onUpdate callback into a promise for terminal state.
 * The latest non-terminal state remains available for agent_end salvage logic.
 */
export function subscribeToEnhancerJobOutcome(args: {
  wsClient: ConvexClient;
  sessionId: string;
  chatroomId: string;
  jobId: string;
}): EnhancerJobOutcomeSubscription {
  let currentState: EnhancerJobState | null = null;
  let resolveOutcome: ((state: EnhancerJobState) => void) | null = null;
  let rejectOutcome: ((error: unknown) => void) | null = null;
  let stopped = false;

  const outcome = new Promise<EnhancerJobState>((resolve, reject) => {
    resolveOutcome = resolve;
    rejectOutcome = reject;
  });

  const unsub = args.wsClient.onUpdate(
    api.web.enhancer.index.getJobOutcome,
    {
      sessionId: args.sessionId as SessionId,
      chatroomId: args.chatroomId as Id<'chatroom_rooms'>,
      jobId: args.jobId as Id<'chatroom_enhancerJobs'>,
    },
    // fallow-ignore-next-line complexity
    (state: EnhancerJobState | null) => {
      if (stopped) return;
      if (!state) {
        rejectOutcome?.(new Error('Enhancer job not found'));
        resolveOutcome = null;
        rejectOutcome = null;
        return;
      }
      currentState = state;
      if (
        state.status === 'complete' ||
        state.status === 'failed' ||
        state.status === 'cancelled'
      ) {
        resolveOutcome?.(state);
        resolveOutcome = null;
        rejectOutcome = null;
      }
    },
    (error: unknown) => {
      if (stopped) return;
      rejectOutcome?.(error);
      resolveOutcome = null;
      rejectOutcome = null;
    }
  );

  return {
    outcome,
    getCurrentState: () => currentState,
    stop: () => {
      if (stopped) return;
      stopped = true;
      unsub();
      resolveOutcome = null;
      rejectOutcome = null;
    },
  };
}
