import { describe, expect, test, vi } from 'vitest';

import {
  handleDirectHarnessInbound,
  type DirectHarnessInboundEvent,
} from './handle-direct-harness-inbound.js';

describe('handleDirectHarnessInbound', () => {
  test('invokes onDirectHarnessEvent when provided', async () => {
    const onDirectHarnessEvent = vi.fn().mockResolvedValue(undefined);
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.session-opened',
      harnessSessionId: 'session_1',
    };

    await handleDirectHarnessInbound({ onDirectHarnessEvent }, event);

    expect(onDirectHarnessEvent).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleDirectHarnessInbound({}, { type: 'direct-harness.command', commandId: 'cmd_1' })
    ).resolves.toBeUndefined();
  });
});
