import { describe, expect, test, vi } from 'vitest';

import {
  handleDirectHarnessInbound,
  type DirectHarnessInboundEvent,
} from './handle-direct-harness-inbound.js';

describe('handleDirectHarnessInbound', () => {
  test('invokes deliverInbound when provided', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.session-opened',
      harnessSessionId: 'session_1',
    };

    await handleDirectHarnessInbound({ deliverInbound }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleDirectHarnessInbound({}, { type: 'direct-harness.command', commandId: 'cmd_1' })
    ).resolves.toBeUndefined();
  });
});
