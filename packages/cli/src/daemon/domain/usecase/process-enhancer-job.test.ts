import { describe, expect, it, vi } from 'vitest';

import { processEnhancerJobInbound, type ProcessEnhancerJobDeps } from './process-enhancer-job.js';

describe('processEnhancerJobInbound', () => {
  it('dispatches enhancer.job-assigned events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: ProcessEnhancerJobDeps = { dispatchInbound };
    const event = { type: 'enhancer.job-assigned' as const, jobId: 'job_1' };

    await processEnhancerJobInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledOnce();
    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
