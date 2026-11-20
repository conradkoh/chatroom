import { describe, expect, it, vi } from 'vitest';

import type { LedgerRequestId } from '../../domain/usecase/repository-ledger-service.js';
import type { DaemonSessionServiceShape } from '../daemon-services.js';
import { createRepositoryLedgerPorts } from './repository-ledger-bridge.js';

vi.mock('../../../api.js', () => ({
  api: {
    machineProjectRoots: {
      list: 'mock-machineProjectRoots-list',
    },
    repositoryLedger: {
      reportResult: 'mock-repositoryLedger-reportResult',
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

  it('maps a snapshot report to api.repositoryLedger.reportResult with session identity', async () => {
    const mutation = vi.fn().mockResolvedValue({ ok: true });
    const session = {
      sessionId: 'session-1',
      machineId: 'machine-1',
      backend: { query: vi.fn(), mutation },
    } as unknown as DaemonSessionServiceShape;

    const ports = createRepositoryLedgerPorts(session);

    await ports.reportSnapshot({
      requestId: 'req-1' as LedgerRequestId,
      status: 'completed',
      entries: [
        {
          path: '/projects/a',
          name: 'a',
          root: '/projects',
          branch: 'main',
          remoteUrl: 'https://github.com/acme/a.git',
          discoveredAt: 10,
        },
      ],
      truncated: false,
      roots: [{ path: '/projects', status: 'ok', repositoryCount: 1 }],
      ledgerGeneratedAt: 11,
    });

    expect(mutation).toHaveBeenCalledWith('mock-repositoryLedger-reportResult', {
      sessionId: 'session-1',
      machineId: 'machine-1',
      requestId: 'req-1',
      status: 'completed',
      entries: [
        {
          path: '/projects/a',
          name: 'a',
          root: '/projects',
          branch: 'main',
          remoteUrl: 'https://github.com/acme/a.git',
          discoveredAt: 10,
        },
      ],
      truncated: false,
      roots: [{ path: '/projects', status: 'ok', repositoryCount: 1 }],
      ledgerGeneratedAt: 11,
    });
  });
});
