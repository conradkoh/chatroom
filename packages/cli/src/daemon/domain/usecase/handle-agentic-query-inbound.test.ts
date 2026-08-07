import { describe, expect, test, vi } from 'vitest';

import {
  handleAgenticQueryInbound,
  type AgenticQueryInboundEvent,
} from './handle-agentic-query-inbound.js';

describe('handleAgenticQueryInbound', () => {
  test('invokes deliverInbound when provided', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: AgenticQueryInboundEvent = {
      type: 'agentic-query.session-opened',
      sessionId: 'run_1',
    };

    await handleAgenticQueryInbound({ deliverInbound }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleAgenticQueryInbound({}, { type: 'agentic-query.prompt', sessionId: 'run_1' })
    ).resolves.toBeUndefined();
  });
});
