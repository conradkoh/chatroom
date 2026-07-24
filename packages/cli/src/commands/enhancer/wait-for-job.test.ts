import { describe, expect, it, vi } from 'vitest';

import { waitForEnhancerJob } from './wait-for-job';

describe('waitForEnhancerJob', () => {
  it('returns cancelled when job status is cancelled', async () => {
    const query = vi.fn().mockResolvedValue({
      status: 'cancelled',
      attemptCount: 1,
      maxAttempts: 3,
    });

    const outcome = await waitForEnhancerJob('room-1', 'job-1', {
      query,
      mutation: vi.fn(),
      getSessionId: async () => 'session-1',
      endpoints: {
        getJob: 'getJob',
        recordAttemptFailure: 'recordAttemptFailure',
      },
    });

    expect(outcome).toBe('cancelled');
  });

  it('returns complete when job status is complete', async () => {
    const query = vi.fn().mockResolvedValue({
      status: 'complete',
      attemptCount: 1,
      maxAttempts: 3,
    });

    const outcome = await waitForEnhancerJob('room-1', 'job-1', {
      query,
      mutation: vi.fn(),
      getSessionId: async () => 'session-1',
      endpoints: {
        getJob: 'getJob',
        recordAttemptFailure: 'recordAttemptFailure',
      },
    });

    expect(outcome).toBe('complete');
  });
});
