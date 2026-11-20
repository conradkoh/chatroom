import { describe, expect, it, vi } from 'vitest';

import type { DaemonSessionServiceShape } from '../daemon-services.js';
import { createRepositoryLedgerPorts } from './repository-ledger-bridge.js';

vi.mock('../../../api.js', () => ({
  api: {
    machineProjectRoots: {
      list: 'mock-machineProjectRoots-list',
    },
  },
}));

describe('createRepositoryLedgerPorts', () => {
  it('maps the roots query result to paths and passes the session identity', async () => {
    const query = vi.fn().mockResolvedValue({
      roots: [
        { rootId: 'root-1', path: '/projects/a', addedAt: 1 },
        { rootId: 'root-2', path: '/projects/b', addedAt: 2 },
      ],
    });
    const session = {
      sessionId: 'session-1',
      machineId: 'machine-1',
      backend: { query, mutation: vi.fn() },
    } as unknown as DaemonSessionServiceShape;

    const ports = createRepositoryLedgerPorts(session);

    await expect(ports.fetchRoots()).resolves.toEqual(['/projects/a', '/projects/b']);
    expect(query).toHaveBeenCalledWith('mock-machineProjectRoots-list', {
      sessionId: 'session-1',
      machineId: 'machine-1',
    });
  });
});
