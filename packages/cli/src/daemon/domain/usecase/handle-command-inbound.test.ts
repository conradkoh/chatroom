import { describe, expect, test, vi } from 'vitest';

import { handleCommandInbound, type CommandInboundEvent } from './handle-command-inbound.js';

describe('handleCommandInbound', () => {
  test('invokes deliverInbound when provided', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
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

    await handleCommandInbound({ deliverInbound }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleCommandInbound({}, { type: 'command-run.updated', runId: 'run_1' })
    ).resolves.toBeUndefined();
  });
});
