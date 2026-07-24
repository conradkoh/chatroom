import { ENHANCER_CLI_POLL_INTERVAL_MS } from '@workspace/backend/config/reliability';

export interface WaitForJobDeps {
  query: (endpoint: unknown, args: Record<string, unknown>) => Promise<unknown>;
  mutation: (endpoint: unknown, args: Record<string, unknown>) => Promise<unknown>;
  getSessionId: () => Promise<string | null>;
}

export type EnhancerJobWaitOutcome = 'complete' | 'failed' | 'cancelled';

// fallow-ignore-next-line complexity
export async function waitForEnhancerJob(
  chatroomId: string,
  jobId: string,
  deps: {
    query: <T>(endpoint: unknown, args: Record<string, unknown>) => Promise<T>;
    mutation: <T>(endpoint: unknown, args: Record<string, unknown>) => Promise<T>;
    getSessionId: () => Promise<string | null>;
    endpoints: {
      getJob: unknown;
      recordAttemptFailure: unknown;
    };
  }
): Promise<EnhancerJobWaitOutcome> {
  const sessionId = await deps.getSessionId();
  if (!sessionId) {
    throw new Error('Not authenticated');
  }

  while (true) {
    const job = await (
      deps.query as (
        endpoint: unknown,
        args: Record<string, unknown>
      ) => Promise<{
        status: string;
        attemptCount: number;
        maxAttempts: number;
        lastError?: string;
        runningSince?: number;
        completedAt?: number;
      } | null>
    )(deps.endpoints.getJob, {
      sessionId,
      chatroomId,
      jobId,
    });

    if (!job) {
      throw new Error('Enhancer job not found');
    }

    if (job.status === 'complete') {
      return 'complete';
    }

    if (job.status === 'cancelled') {
      return 'cancelled';
    }

    if (job.status === 'failed') {
      return 'failed';
    }

    await sleep(ENHANCER_CLI_POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
