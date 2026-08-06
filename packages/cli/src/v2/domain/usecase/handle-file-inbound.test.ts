import { describe, expect, test, vi } from 'vitest';

import { handleFileInbound, type FileInboundEvent } from './handle-file-inbound.js';

describe('handleFileInbound', () => {
  test('invokes deliverInbound for file-tree.request', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: FileInboundEvent = {
      type: 'file-tree.request',
      requestId: 'req_1',
    };

    await handleFileInbound({ deliverInbound }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('invokes deliverInbound for file-content.request', async () => {
    const deliverInbound = vi.fn().mockResolvedValue(undefined);
    const event: FileInboundEvent = {
      type: 'file-content.request',
      requestId: 'req_2',
    };

    await handleFileInbound({ deliverInbound }, event);

    expect(deliverInbound).toHaveBeenCalledWith(event);
  });

  test('no-ops when hook is absent', async () => {
    await expect(
      handleFileInbound({}, { type: 'file-write.request', requestId: 'req_3' })
    ).resolves.toBeUndefined();
  });
});
