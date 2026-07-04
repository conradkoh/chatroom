import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetDirListingSyncCacheForTests, syncDirListingToBackend } from './dir-listing-sync.js';

const mockListDirectory = vi.fn();

vi.mock('./dir-listing-scanner.js', () => ({
  listDirectory: (...args: unknown[]) => mockListDirectory(...args),
}));

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      syncDirListingV2: 'mock-syncDirListingV2',
    },
  },
}));

describe('syncDirListingToBackend', () => {
  const session = {
    sessionId: 'session-1',
    machineId: 'machine-1',
    backend: {
      mutation: vi.fn().mockResolvedValue(undefined),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetDirListingSyncCacheForTests();
  });

  it('skips mutation when listing content is unchanged', async () => {
    const listing = {
      dirPath: '',
      entries: [{ name: 'a.ts', path: 'a.ts', type: 'file' as const }],
      scannedAt: 1000,
      truncated: false,
      totalCount: 1,
    };

    mockListDirectory
      .mockResolvedValueOnce(listing)
      .mockResolvedValueOnce({ ...listing, scannedAt: 2000 });

    await syncDirListingToBackend(session as never, '/workspace', '');
    await syncDirListingToBackend(session as never, '/workspace', '');

    expect(session.backend.mutation).toHaveBeenCalledTimes(1);
  });
});
