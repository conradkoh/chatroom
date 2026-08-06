import { describe, expect, it, vi } from 'vitest';

import { createCapabilitiesPublisher } from './capabilities.js';

describe('createCapabilitiesPublisher', () => {
  it('publishes machine capabilities on capabilities.updated', async () => {
    const mutation = vi.fn().mockResolvedValue(undefined);
    const publisher = createCapabilitiesPublisher({
      backend: { mutation, query: vi.fn() },
      sessionId: 'sess-1',
      machineId: 'machine-1',
    });

    const capabilities = {
      machineId: 'machine-1',
      lastSeenAt: 1000,
      workspaces: [
        {
          workspaceId: 'ws-1',
          cwd: '/test',
          name: 'Test',
          harnesses: [],
        },
      ],
    };

    await publisher.publish({ type: 'capabilities.updated', capabilities });

    expect(mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        sessionId: 'sess-1',
        machineId: 'machine-1',
        workspaces: [
          expect.objectContaining({
            workspaceId: 'ws-1',
            cwd: '/test',
            name: 'Test',
            harnesses: [],
          }),
        ],
      })
    );
  });
});
