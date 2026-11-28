import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createFolderBrowseService,
  type FolderBrowseServicePorts,
  type PendingFolderBrowse,
} from './folder-browse-service.js';
import type { ListBrowseDirectoryResult } from '../../../infrastructure/local-actions/list-browse-directory.js';

function row(overrides: Partial<PendingFolderBrowse> = {}): PendingFolderBrowse {
  return { browseId: 'b1', navSeq: 1, path: '/tmp', showHidden: false, filter: null, ...overrides };
}

function listing(path = '/tmp'): ListBrowseDirectoryResult {
  return {
    kind: 'listing',
    path,
    parentPath: '/',
    entries: [{ name: 'alpha' }],
    dirCount: 1,
    fileCount: 0,
    hiddenCount: 0,
    complete: true,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Drains pending microtasks so chained awaits in the service reach their next suspension point. */
async function settle(times = 32): Promise<void> {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

function createPorts(overrides: Partial<FolderBrowseServicePorts> = {}): FolderBrowseServicePorts {
  return {
    listDirectory: vi.fn(async () => listing()),
    reportListing: vi.fn(async () => ({ outcome: 'applied' })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createFolderBrowseService', () => {
  it('lists a pending row once and reports it', async () => {
    const ports = createPorts({
      listDirectory: vi.fn(async (input) => listing(input.path ?? '')),
    });
    const service = createFolderBrowseService(ports);

    service.onPending([row({ navSeq: 4, path: '/tmp/work' })]);
    service.onPending([row({ navSeq: 4, path: '/tmp/work' })]);
    await settle();

    expect(ports.listDirectory).toHaveBeenCalledOnce();
    expect(ports.listDirectory).toHaveBeenCalledWith({
      path: '/tmp/work',
      showHidden: false,
      filter: null,
    });
    expect(ports.reportListing).toHaveBeenCalledOnce();
    expect(ports.reportListing).toHaveBeenCalledWith({
      browseId: 'b1',
      navSeq: 4,
      result: listing('/tmp/work'),
    });
  });

  it('a newer navSeq supersedes a queued one', async () => {
    const gate = deferred<void>();
    const listedPaths: string[] = [];
    const ports = createPorts({
      listDirectory: vi.fn(async (input) => {
        listedPaths.push(input.path ?? '');
        await gate.promise;
        return listing(input.path ?? '');
      }),
    });
    const service = createFolderBrowseService(ports, { concurrency: 1 });

    service.onPending([row({ navSeq: 1, path: '/v1' })]);
    service.onPending([row({ navSeq: 2, path: '/v2' })]);
    service.onPending([row({ navSeq: 3, path: '/v3' })]);
    gate.resolve();
    await settle();

    expect(listedPaths).toEqual(['/v1', '/v3']);
    const reportedSeqs = vi.mocked(ports.reportListing).mock.calls.map(([args]) => args.navSeq);
    expect(reportedSeqs).toEqual([1, 3]);
  });

  it('runs at most two listings at once', async () => {
    const gates: ReturnType<typeof deferred<ListBrowseDirectoryResult>>[] = [];
    const ports = createPorts({
      listDirectory: vi.fn(() => {
        const gate = deferred<ListBrowseDirectoryResult>();
        gates.push(gate);
        return gate.promise;
      }),
    });
    const service = createFolderBrowseService(ports);

    service.onPending([row({ browseId: 'b1' }), row({ browseId: 'b2' }), row({ browseId: 'b3' })]);
    await settle();
    expect(ports.listDirectory).toHaveBeenCalledTimes(2);

    gates[0]?.resolve(listing());
    await settle();
    expect(ports.listDirectory).toHaveBeenCalledTimes(3);

    gates[1]?.resolve(listing());
    gates[2]?.resolve(listing());
    await settle();
  });

  it('drops queued work when the browse leaves the snapshot', async () => {
    const gate = deferred<void>();
    const ports = createPorts({
      listDirectory: vi.fn(async (input) => {
        await gate.promise;
        return listing(input.path ?? '');
      }),
    });
    const service = createFolderBrowseService(ports, { concurrency: 1 });

    service.onPending([row({ browseId: 'b1' }), row({ browseId: 'b2' })]);
    service.onPending([row({ browseId: 'b1' })]);
    gate.resolve();
    await settle();

    expect(ports.listDirectory).toHaveBeenCalledOnce();
    expect(vi.mocked(ports.reportListing).mock.calls.map(([args]) => args.browseId)).toEqual([
      'b1',
    ]);
  });

  it('does not report a listing whose browse left the snapshot', async () => {
    const gate = deferred<ListBrowseDirectoryResult>();
    const ports = createPorts({ listDirectory: vi.fn(() => gate.promise) });
    const service = createFolderBrowseService(ports);

    service.onPending([row()]);
    await settle();
    service.onPending([]);
    gate.resolve(listing());
    await settle();

    expect(ports.reportListing).not.toHaveBeenCalled();
  });

  it('retries a rejected report once', async () => {
    vi.useFakeTimers();
    const ports = createPorts({
      reportListing: vi
        .fn()
        .mockRejectedValueOnce(new Error('network'))
        .mockResolvedValueOnce({ outcome: 'applied' }),
    });
    const service = createFolderBrowseService(ports, { reportRetryDelayMs: 1_000 });

    service.onPending([row()]);
    await vi.advanceTimersByTimeAsync(0);
    expect(ports.reportListing).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(ports.reportListing).toHaveBeenCalledTimes(2);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('gives up after the single retry and warns', async () => {
    vi.useFakeTimers();
    const ports = createPorts({
      reportListing: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const service = createFolderBrowseService(ports, { reportRetryDelayMs: 1_000 });

    service.onPending([row()]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(ports.reportListing).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Folder browse report failed')
    );
  });

  it.each(['stale', 'not_found'] as const)(
    'ignores a %s outcome without retrying',
    async (outcome) => {
      const ports = createPorts({
        reportListing: vi.fn(async () => ({ outcome })),
      });
      const service = createFolderBrowseService(ports);

      service.onPending([row()]);
      await settle();

      expect(ports.reportListing).toHaveBeenCalledOnce();
      expect(console.debug).toHaveBeenCalledWith(expect.stringContaining(outcome));
      expect(console.warn).not.toHaveBeenCalled();
    }
  );

  it('stop cancels a report retry that is waiting out its delay', async () => {
    vi.useFakeTimers();
    const ports = createPorts({
      reportListing: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const service = createFolderBrowseService(ports, { reportRetryDelayMs: 1_000 });

    service.onPending([row()]);
    await vi.advanceTimersByTimeAsync(0);
    service.stop();
    await vi.advanceTimersByTimeAsync(1_000);

    expect(ports.reportListing).toHaveBeenCalledOnce();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('keeps serving when a listing rejects', async () => {
    const ports = createPorts({
      listDirectory: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue(listing('/later')),
    });
    const service = createFolderBrowseService(ports);

    service.onPending([row({ browseId: 'b1' })]);
    await settle();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Folder browse listing failed')
    );

    service.onPending([row({ browseId: 'b1' }), row({ browseId: 'b2', path: '/later' })]);
    await settle();

    expect(vi.mocked(ports.reportListing).mock.calls.map(([args]) => args.browseId)).toEqual([
      'b2',
    ]);
  });

  it('stop cancels queued work and ignores later snapshots', async () => {
    const gate = deferred<void>();
    const ports = createPorts({
      listDirectory: vi.fn(async (input) => {
        await gate.promise;
        return listing(input.path ?? '');
      }),
    });
    const service = createFolderBrowseService(ports, { concurrency: 1 });

    service.onPending([row({ browseId: 'b1' }), row({ browseId: 'b2' })]);
    service.stop();
    gate.resolve();
    await settle();

    expect(ports.listDirectory).toHaveBeenCalledOnce();
    expect(ports.reportListing).not.toHaveBeenCalled();

    service.onPending([row({ browseId: 'b3' })]);
    await settle();
    expect(ports.listDirectory).toHaveBeenCalledOnce();
  });
});
