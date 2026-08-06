import { describe, expect, test, vi } from 'vitest';

import { handleEnhancerInbound, type EnhancerInboundEvent } from './handle-enhancer-inbound.js';

describe('handleEnhancerInbound', () => {
  test('invokes onEnhancerEvent when provided', async () => {
    const onEnhancerEvent = vi.fn().mockResolvedValue(undefined);
    const event: EnhancerInboundEvent = {
      type: 'enhancer.job-assigned',
      jobId: 'job_1',
    };

    await handleEnhancerInbound({ onEnhancerEvent }, event);

    expect(onEnhancerEvent).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleEnhancerInbound({}, { type: 'enhancer.job-assigned', jobId: 'job_1' })
    ).resolves.toBeUndefined();
  });
});
