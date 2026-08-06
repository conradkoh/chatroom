import { describe, expect, test, vi } from 'vitest';

import { handleCommandInbound, type CommandInboundEvent } from './handle-command-inbound.js';

describe('handleCommandInbound', () => {
  test('invokes onCommandEvent when provided', async () => {
    const onCommandEvent = vi.fn().mockResolvedValue(undefined);
    const event: CommandInboundEvent = {
      type: 'command.received',
      commandId: 'cmd_1',
    };

    await handleCommandInbound({ onCommandEvent }, event);

    expect(onCommandEvent).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleCommandInbound({}, { type: 'command-run.updated', runId: 'run_1' })
    ).resolves.toBeUndefined();
  });
});
