import { describe, expect, it, vi } from 'vitest';

import type { DirectHarnessInboundEvent } from './handle-direct-harness-inbound.js';
import {
  processDirectHarnessInbound,
  type ProcessDirectHarnessInboundDeps,
} from './process-direct-harness-prompt.js';

describe('processDirectHarnessInbound', () => {
  it('dispatches session-opened events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: ProcessDirectHarnessInboundDeps = { dispatchInbound };
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.session-opened',
      harnessSessionId: 'session_1',
    };

    await processDirectHarnessInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });

  it('dispatches prompt events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: ProcessDirectHarnessInboundDeps = { dispatchInbound };
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.prompt',
      harnessSessionId: 'session_1',
    };

    await processDirectHarnessInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });

  it('dispatches command events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: ProcessDirectHarnessInboundDeps = { dispatchInbound };
    const event: DirectHarnessInboundEvent = {
      type: 'direct-harness.command',
      commandId: 'cmd_1',
    };

    await processDirectHarnessInbound(deps, event);

    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
