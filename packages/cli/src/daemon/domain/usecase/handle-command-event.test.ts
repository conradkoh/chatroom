import { describe, expect, it, vi } from 'vitest';

import { handleCommandEvent, type HandleCommandEventDeps } from './handle-command-event.js';
import type { CommandInboundEvent } from './handle-command-inbound.js';

describe('handleCommandEvent', () => {
  it('dispatches command.received events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: HandleCommandEventDeps = { dispatchInbound };
    const event: CommandInboundEvent = {
      type: 'command.received',
      commandId: 'cmd_1',
      claimedCommand: {
        commandId: 'cmd_1',
        machineId: 'm',
        deadline: Date.now() + 1000,
        timestamp: Date.now(),
        type: 'daemon.ping',
      },
    };

    await handleCommandEvent(deps, event);

    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });

  it('dispatches command-run.updated events to port', async () => {
    const dispatchInbound = vi.fn().mockResolvedValue(undefined);
    const deps: HandleCommandEventDeps = { dispatchInbound };
    const event: CommandInboundEvent = {
      type: 'command-run.updated',
      runId: 'run_1',
    };

    await handleCommandEvent(deps, event);

    expect(dispatchInbound).toHaveBeenCalledWith(event);
  });
});
