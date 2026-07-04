import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  resetDirListingSyncCacheForTests,
  syncDirListingToBackend,
  syncDirListingsToBackend,
} from './dir-listing-sync.js';

const mockListDirectory = vi.fn();

vi.mock('./dir-listing-scanner.js', () => ({
  listDirectory: (...args: unknown[]) => mockListDirectory(...args),
}));

vi.mock('../../../api.js', () => ({
  api: {
    workspaceFiles: {
      syncDirListingV2: 'mock-syncDirListingV2',
      syncDirListingV2Batch: 'mock-syncDirListingV2Batch',
    },
  },
}));

function makeListing(dirPath: string, name: string) {
  return {
    dirPath,
    entries: [{ name, path: dirPath ? `${dirPath}/${name}` : name, type: 'file' as const }],
    scannedAt: 1000,
    truncated: false,
    totalCount: 1,
  };
}

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

describe('syncDirListingsToBackend', () => {
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

  it('uses batch mutation once for multiple dirs', async () => {
    mockListDirectory
      .mockResolvedValueOnce(makeListing('', 'a.ts'))
      .mockResolvedValueOnce(makeListing('src', 'b.ts'))
      .mockResolvedValueOnce(makeListing('lib', 'c.ts'));

    await syncDirListingsToBackend(session as never, '/workspace', ['', 'src', 'lib']);

    expect(session.backend.mutation).toHaveBeenCalledTimes(1);
    expect(session.backend.mutation).toHaveBeenCalledWith('mock-syncDirListingV2Batch', {
      sessionId: 'session-1',
      machineId: 'machine-1',
      workingDir: '/workspace',
      items: expect.arrayContaining([
        expect.objectContaining({ dirPath: '' }),
        expect.objectContaining({ dirPath: 'src' }),
        expect.objectContaining({ dirPath: 'lib' }),
      ]),
    });
    expect(session.backend.mutation).not.toHaveBeenCalledWith(
      'mock-syncDirListingV2',
      expect.anything()
    );
  });

  it('uses single mutation for one dir', async () => {
    mockListDirectory.mockResolvedValueOnce(makeListing('', 'a.ts'));

    await syncDirListingsToBackend(session as never, '/workspace', ['']);

    expect(session.backend.mutation).toHaveBeenCalledTimes(1);
    expect(session.backend.mutation).toHaveBeenCalledWith(
      'mock-syncDirListingV2',
      expect.objectContaining({ dirPath: '' })
    );
  });
});
