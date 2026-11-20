import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRepositoryLedgerService,
  type LedgerRequestId,
  type RepositoryLedgerPorts,
  type RepositoryLedgerSnapshotReport,
} from './repository-ledger-service.js';
import type {
  LedgerRepository,
  ScanResult,
} from '../../../infrastructure/local-actions/scan-repositories.js';
import { scanRepositories } from '../../../infrastructure/local-actions/scan-repositories.js';
import {
  createRepositoryLedgerStore,
  type RepositoryLedgerStore,
  type StoredLedger,
} from '../../infrastructure/local/repository-ledger-store.js';

const ROOT = '/roots';
const REQUEST_ID = 'req-1' as LedgerRequestId;
const REPO_A: LedgerRepository = {
  path: '/roots/a',
  name: 'a',
  root: ROOT,
  branch: 'main',
  remoteUrl: 'https://github.com/acme/a.git',
};

function okScan(repositories: LedgerRepository[] = [REPO_A]): ScanResult {
  return {
    repositories,
    roots: [{ path: ROOT, status: 'ok', repositoryCount: repositories.length }],
    truncated: false,
  };
}

/** In-memory store: the service only ever sees this port shape. */
function createMemoryStore(initial: StoredLedger | null = null) {
  let stored = initial;
  const store: RepositoryLedgerStore & {
    written: StoredLedger[];
    clearCalls: number;
  } = {
    written: [],
    clearCalls: 0,
    read: vi.fn(async () => stored),
    write: vi.fn(async (ledger: StoredLedger) => {
      stored = ledger;
      store.written.push(ledger);
    }),
    clear: vi.fn(async () => {
      stored = null;
      store.clearCalls += 1;
    }),
  };
  return store;
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

function createPorts(overrides: Partial<RepositoryLedgerPorts> = {}): {
  ports: RepositoryLedgerPorts;
  store: ReturnType<typeof createMemoryStore>;
} {
  const store = createMemoryStore();
  const ports: RepositoryLedgerPorts = {
    fetchRoots: vi.fn(async () => [ROOT]),
    scan: vi.fn(async () => okScan()),
    store,
    now: () => 1_000,
    reportSnapshot: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  return { ports, store };
}

function storedLedger(entries: StoredLedger['entries'], truncated = false): StoredLedger {
  return {
    version: 1,
    generatedAt: 500,
    roots: [ROOT],
    rootStatuses: [{ path: ROOT, status: 'ok', repositoryCount: entries.length }],
    truncated,
    entries,
  };
}

/** Resolves with the single report the service sent. */
async function reported(ports: RepositoryLedgerPorts): Promise<RepositoryLedgerSnapshotReport> {
  const reportSnapshot = ports.reportSnapshot as ReturnType<typeof vi.fn>;
  await vi.waitFor(() => expect(reportSnapshot).toHaveBeenCalledTimes(1));
  return reportSnapshot.mock.calls[0]?.[0] as RepositoryLedgerSnapshotReport;
}

function snapshotReport(
  ports: RepositoryLedgerPorts
): ReturnType<typeof vi.fn> & ((report: RepositoryLedgerSnapshotReport) => Promise<unknown>) {
  return ports.reportSnapshot as ReturnType<typeof vi.fn> &
    ((report: RepositoryLedgerSnapshotReport) => Promise<unknown>);
}

describe('createRepositoryLedgerService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('writes a ledger from fetched roots and a scan', async () => {
    const { ports, store } = createPorts();

    await createRepositoryLedgerService(ports).refresh('boot');

    expect(store.written).toEqual([
      {
        version: 1,
        generatedAt: 1_000,
        roots: [ROOT],
        rootStatuses: [{ path: ROOT, status: 'ok', repositoryCount: 1 }],
        truncated: false,
        entries: [{ ...REPO_A, discoveredAt: 1_000 }],
      },
    ]);
    expect(ports.scan).toHaveBeenCalledWith([ROOT]);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('preserves discoveredAt for unchanged paths and stamps new paths', async () => {
    const previous: StoredLedger = {
      version: 1,
      generatedAt: 500,
      roots: [ROOT],
      rootStatuses: [{ path: ROOT, status: 'ok', repositoryCount: 1 }],
      truncated: false,
      entries: [{ ...REPO_A, discoveredAt: 500 }],
    };
    const repoB: LedgerRepository = {
      path: '/roots/b',
      name: 'b',
      root: ROOT,
      branch: null,
      remoteUrl: null,
    };
    const store = createMemoryStore(previous);
    const { ports } = createPorts({
      store,
      scan: vi.fn(async () => okScan([REPO_A, repoB])),
      now: () => 2_000,
    });

    await createRepositoryLedgerService(ports).refresh('roots-changed');

    expect(store.written[0]?.entries).toEqual([
      { ...REPO_A, discoveredAt: 500 },
      { ...repoB, discoveredAt: 2_000 },
    ]);
  });

  it('drops repositories that belong to a removed root on the next refresh', async () => {
    const repoB: LedgerRepository = {
      path: '/roots/b',
      name: 'b',
      root: '/roots/b',
      branch: null,
      remoteUrl: null,
    };
    const previous: StoredLedger = {
      version: 1,
      generatedAt: 500,
      roots: [ROOT, '/roots/b'],
      rootStatuses: [
        { path: ROOT, status: 'ok', repositoryCount: 1 },
        { path: '/roots/b', status: 'ok', repositoryCount: 1 },
      ],
      truncated: false,
      entries: [
        { ...REPO_A, discoveredAt: 500 },
        { ...repoB, discoveredAt: 500 },
      ],
    };
    const fetchRoots = vi.fn(async () => [ROOT]);
    const store = createMemoryStore(previous);
    const { ports } = createPorts({
      store,
      fetchRoots,
      scan: vi.fn(async () => okScan([REPO_A])),
      now: () => 2_000,
    });

    await createRepositoryLedgerService(ports).refresh('roots-changed');

    expect(fetchRoots).toHaveBeenCalledTimes(1);
    expect(store.written[0]?.roots).toEqual([ROOT]);
    expect(store.written[0]?.entries).toEqual([{ ...REPO_A, discoveredAt: 500 }]);
  });

  it('clears the store when no roots are configured and never scans', async () => {
    const { ports, store } = createPorts({ fetchRoots: vi.fn(async () => []) });

    await createRepositoryLedgerService(ports).refresh('boot');

    expect(store.clear).toHaveBeenCalledTimes(1);
    expect(ports.scan).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });

  it('falls back to stored roots when fetching roots fails', async () => {
    const previous: StoredLedger = {
      version: 1,
      generatedAt: 500,
      roots: [ROOT],
      rootStatuses: [{ path: ROOT, status: 'ok', repositoryCount: 1 }],
      truncated: false,
      entries: [{ ...REPO_A, discoveredAt: 500 }],
    };
    const store = createMemoryStore(previous);
    const { ports } = createPorts({
      store,
      fetchRoots: vi.fn(async () => {
        throw new Error('backend offline');
      }),
    });

    await expect(createRepositoryLedgerService(ports).refresh('boot')).resolves.toEqual({
      ok: true,
    });

    expect(ports.scan).toHaveBeenCalledWith([ROOT]);
    expect(store.write).toHaveBeenCalledTimes(1);
  });

  it('skips silently when fetching roots fails and nothing is stored', async () => {
    const { ports, store } = createPorts({
      fetchRoots: vi.fn(async () => {
        throw new Error('backend offline');
      }),
    });

    await expect(createRepositoryLedgerService(ports).refresh('boot')).resolves.toEqual({
      ok: false,
      errorMessage: 'Project roots could not be read',
    });

    expect(ports.scan).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
    expect(store.clear).not.toHaveBeenCalled();
  });

  it('persists truncated scans and non-ok root statuses as-is', async () => {
    const scan: ScanResult = {
      repositories: [],
      roots: [
        { path: '/roots/missing', status: 'missing', repositoryCount: 0 },
        { path: '/roots/capped', status: 'ok', repositoryCount: 0 },
      ],
      truncated: true,
    };
    const { ports, store } = createPorts({
      fetchRoots: vi.fn(async () => ['/roots/missing', '/roots/capped']),
      scan: vi.fn(async () => scan),
    });

    await createRepositoryLedgerService(ports).refresh('manual');

    expect(store.written[0]).toEqual({
      version: 1,
      generatedAt: 1_000,
      roots: ['/roots/missing', '/roots/capped'],
      rootStatuses: scan.roots,
      truncated: true,
      entries: [],
    });
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('coalesces triggers during a scan into one rerun with fresh roots', async () => {
    const firstScan = deferred<ScanResult>();
    const repoTwo: LedgerRepository = {
      path: '/roots/two/b',
      name: 'b',
      root: '/roots/two',
      branch: null,
      remoteUrl: null,
    };
    const scan = vi
      .fn<(roots: string[]) => Promise<ScanResult>>()
      .mockReturnValueOnce(firstScan.promise)
      .mockResolvedValueOnce({
        repositories: [repoTwo],
        roots: [{ path: '/roots/two', status: 'ok', repositoryCount: 1 }],
        truncated: false,
      });
    const fetchRoots = vi
      .fn<() => Promise<string[]>>()
      .mockResolvedValueOnce(['/roots/one'])
      .mockResolvedValueOnce(['/roots/two']);
    const { ports } = createPorts({ scan, fetchRoots });

    const service = createRepositoryLedgerService(ports);
    const first = service.refresh('boot');
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
    const second = service.refresh('roots-changed');
    const third = service.refresh('roots-changed');
    const fourth = service.refresh('roots-changed');

    firstScan.resolve(okScan());
    await Promise.all([first, second, third, fourth]);

    expect(scan).toHaveBeenCalledTimes(2);
    expect(scan).toHaveBeenLastCalledWith(['/roots/two']);
    expect(fetchRoots).toHaveBeenCalledTimes(2);
  });

  it('still reruns when a pass throws, and refresh never rejects', async () => {
    const scan = vi
      .fn<(roots: string[]) => Promise<ScanResult>>()
      .mockRejectedValueOnce(new Error('scan blew up'))
      .mockResolvedValueOnce(okScan());
    const { ports } = createPorts({ scan });

    const service = createRepositoryLedgerService(ports);
    const first = service.refresh('boot');
    await vi.waitFor(() => expect(scan).toHaveBeenCalledTimes(1));
    const queued = service.refresh('roots-changed');

    await expect(Promise.all([first, queued])).resolves.toEqual([
      { ok: false, errorMessage: 'scan blew up' },
      { ok: true },
    ]);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Repository ledger refresh failed')
    );
  });

  it('resolves refresh with { ok: false } when the scan throws', async () => {
    const { ports } = createPorts({
      scan: vi.fn(async () => {
        throw new Error('scan exploded');
      }),
    });

    await expect(createRepositoryLedgerService(ports).refresh('manual')).resolves.toEqual({
      ok: false,
      errorMessage: 'scan exploded',
    });
  });

  it('never reports a snapshot during refresh', async () => {
    const { ports } = createPorts();

    await createRepositoryLedgerService(ports).refresh('boot');

    expect(ports.reportSnapshot).not.toHaveBeenCalled();
  });

  it('has no polling timers or filesystem watchers', () => {
    const serviceSource = readFileSync(
      new URL('./repository-ledger-service.ts', import.meta.url),
      'utf8'
    );
    const storeSource = readFileSync(
      new URL('../../infrastructure/local/repository-ledger-store.ts', import.meta.url),
      'utf8'
    );

    for (const source of [serviceSource, storeSource]) {
      expect(source).not.toMatch(/setInterval|fs\.watch|\bwatch\(|chokidar/);
    }
    // The only timer is the snapshot report retry backoff.
    expect(serviceSource.match(/setTimeout/g)).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // serveSnapshot
  // -------------------------------------------------------------------------

  it('scans once and reports completed when no ledger is stored and rescan is false', async () => {
    const { ports } = createPorts();
    const service = createRepositoryLedgerService(ports);

    expect(service.serveSnapshot({ requestId: REQUEST_ID, rescan: false })).toBe('started');
    const report = await reported(ports);

    expect(ports.scan).toHaveBeenCalledTimes(1);
    expect(report).toEqual({
      requestId: REQUEST_ID,
      status: 'completed',
      entries: [{ ...REPO_A, discoveredAt: 1_000 }],
      truncated: false,
      roots: [{ path: ROOT, status: 'ok', repositoryCount: 1 }],
      ledgerGeneratedAt: 1_000,
    });
  });

  it('uses the stored ledger without scanning when rescan is false', async () => {
    const store = createMemoryStore(storedLedger([{ ...REPO_A, discoveredAt: 500 }]));
    const { ports } = createPorts({ store });
    const service = createRepositoryLedgerService(ports);

    service.serveSnapshot({ requestId: REQUEST_ID, rescan: false });
    const report = await reported(ports);

    expect(ports.scan).not.toHaveBeenCalled();
    expect(report).toEqual({
      requestId: REQUEST_ID,
      status: 'completed',
      entries: [{ ...REPO_A, discoveredAt: 500 }],
      truncated: false,
      roots: [{ path: ROOT, status: 'ok', repositoryCount: 1 }],
      ledgerGeneratedAt: 500,
    });
  });

  it('always scans when rescan is true even with a stored ledger', async () => {
    const store = createMemoryStore(storedLedger([{ ...REPO_A, discoveredAt: 500 }]));
    const { ports } = createPorts({ store });
    const service = createRepositoryLedgerService(ports);

    service.serveSnapshot({ requestId: REQUEST_ID, rescan: true });
    const report = await reported(ports);

    expect(ports.scan).toHaveBeenCalledTimes(1);
    expect(report.status).toBe('completed');
    expect(report).toMatchObject({ ledgerGeneratedAt: 1_000 });
  });

  it('reports completed with empty arrays when no roots are configured', async () => {
    const { ports } = createPorts({ fetchRoots: vi.fn(async () => []) });
    const service = createRepositoryLedgerService(ports);

    service.serveSnapshot({ requestId: REQUEST_ID, rescan: true });
    const report = await reported(ports);

    expect(ports.scan).not.toHaveBeenCalled();
    expect(report).toEqual({
      requestId: REQUEST_ID,
      status: 'completed',
      entries: [],
      truncated: false,
      roots: [],
    });
  });

  it('returns duplicate for a request already in flight and reports once', async () => {
    const scan = deferred<ScanResult>();
    const { ports } = createPorts({ scan: vi.fn(() => scan.promise) });
    const service = createRepositoryLedgerService(ports);

    expect(service.serveSnapshot({ requestId: REQUEST_ID, rescan: true })).toBe('started');
    await vi.waitFor(() => expect(ports.scan).toHaveBeenCalledTimes(1));
    expect(service.serveSnapshot({ requestId: REQUEST_ID, rescan: true })).toBe('duplicate');

    scan.resolve(okScan());
    await reported(ports);

    expect(snapshotReport(ports)).toHaveBeenCalledTimes(1);
  });

  it('reports failed with the thrown message when the scan throws', async () => {
    const { ports } = createPorts({
      scan: vi.fn(async () => {
        throw new Error('scan failed hard');
      }),
    });
    const service = createRepositoryLedgerService(ports);

    service.serveSnapshot({ requestId: REQUEST_ID, rescan: false });
    const report = await reported(ports);

    expect(report).toEqual({
      requestId: REQUEST_ID,
      status: 'failed',
      errorMessage: 'scan failed hard',
    });
  });

  it('reports failed when roots cannot be read and nothing is stored', async () => {
    const { ports } = createPorts({
      fetchRoots: vi.fn(async () => {
        throw new Error('backend offline');
      }),
    });
    const service = createRepositoryLedgerService(ports);

    service.serveSnapshot({ requestId: REQUEST_ID, rescan: true });
    const report = await reported(ports);

    expect(report).toEqual({
      requestId: REQUEST_ID,
      status: 'failed',
      errorMessage: 'Project roots could not be read',
    });
  });

  it('retries a transient report failure on a 1s then 2s schedule', async () => {
    vi.useFakeTimers();
    const reportSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error('report boom'))
      .mockRejectedValueOnce(new Error('report boom'))
      .mockResolvedValueOnce({ ok: true });
    const { ports } = createPorts({ reportSnapshot });
    const service = createRepositoryLedgerService(ports);

    service.serveSnapshot({ requestId: REQUEST_ID, rescan: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(reportSnapshot).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(reportSnapshot).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(reportSnapshot).toHaveBeenCalledTimes(3);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('gives up after four attempts and warns once when the report always fails', async () => {
    vi.useFakeTimers();
    const reportSnapshot = vi.fn().mockRejectedValue(new Error('always down'));
    const { ports } = createPorts({ reportSnapshot });
    const service = createRepositoryLedgerService(ports);

    service.serveSnapshot({ requestId: REQUEST_ID, rescan: false });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(2_000);
    await vi.advanceTimersByTimeAsync(4_000);

    expect(reportSnapshot).toHaveBeenCalledTimes(4);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Repository ledger snapshot report failed after retries')
    );
  });

  it('omits null branch and remoteUrl instead of sending null', async () => {
    const repoB: LedgerRepository = {
      path: '/roots/b',
      name: 'b',
      root: ROOT,
      branch: null,
      remoteUrl: null,
    };
    const store = createMemoryStore(
      storedLedger([
        { ...REPO_A, discoveredAt: 500 },
        { ...repoB, discoveredAt: 500 },
      ])
    );
    const { ports } = createPorts({ store });

    createRepositoryLedgerService(ports).serveSnapshot({ requestId: REQUEST_ID, rescan: false });
    const report = await reported(ports);

    expect(report.status).toBe('completed');
    if (report.status !== 'completed') throw new Error('expected completed');
    expect(report.entries[1]).toEqual({
      path: '/roots/b',
      name: 'b',
      root: ROOT,
      discoveredAt: 500,
    });
    expect(report.entries[1]).not.toHaveProperty('branch');
    expect(report.entries[1]).not.toHaveProperty('remoteUrl');
  });

  it('drops over-cap entries rather than truncating them', async () => {
    const longPath = `/${'p'.repeat(1_024)}`; // 1025 characters
    const longRemote = `https://example.com/${'r'.repeat(2_049 - 'https://example.com/'.length)}`;
    expect(longPath).toHaveLength(1_025);
    expect(longRemote).toHaveLength(2_049);
    const store = createMemoryStore(
      storedLedger([
        { ...REPO_A, discoveredAt: 500 },
        {
          path: longPath,
          name: 'long-path',
          root: ROOT,
          branch: 'main',
          remoteUrl: null,
          discoveredAt: 500,
        },
        {
          path: '/roots/c',
          name: 'c',
          root: ROOT,
          branch: 'main',
          remoteUrl: longRemote,
          discoveredAt: 500,
        },
      ])
    );
    const { ports } = createPorts({ store });

    createRepositoryLedgerService(ports).serveSnapshot({ requestId: REQUEST_ID, rescan: false });
    const report = await reported(ports);

    expect(report.status).toBe('completed');
    if (report.status !== 'completed') throw new Error('expected completed');
    expect(report.entries).toEqual([{ ...REPO_A, discoveredAt: 500 }]);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Repository ledger snapshot dropped 2 over-cap entries')
    );
  });

  it('keeps the first entry for a duplicated path', async () => {
    const first: LedgerRepository = { ...REPO_A, name: 'first' };
    const second: LedgerRepository = { ...REPO_A, name: 'second' };
    const store = createMemoryStore(
      storedLedger([
        { ...first, discoveredAt: 500 },
        { ...second, discoveredAt: 500 },
      ])
    );
    const { ports } = createPorts({ store });

    createRepositoryLedgerService(ports).serveSnapshot({ requestId: REQUEST_ID, rescan: false });
    const report = await reported(ports);

    expect(report.status).toBe('completed');
    if (report.status !== 'completed') throw new Error('expected completed');
    expect(report.entries).toEqual([{ ...first, discoveredAt: 500 }]);
  });

  it('sends 1000 of 1001 entries and marks the report truncated', async () => {
    const entries = Array.from({ length: 1_001 }, (_, index) => ({
      path: `/roots/repo-${index}`,
      name: `repo-${index}`,
      root: ROOT,
      branch: null,
      remoteUrl: null,
      discoveredAt: 500,
    }));
    const store = createMemoryStore(storedLedger(entries));
    const { ports } = createPorts({ store });

    createRepositoryLedgerService(ports).serveSnapshot({ requestId: REQUEST_ID, rescan: false });
    const report = await reported(ports);

    expect(report.status).toBe('completed');
    if (report.status !== 'completed') throw new Error('expected completed');
    expect(report.entries).toHaveLength(1_000);
    expect(report.truncated).toBe(true);
  });
});

describe('createRepositoryLedgerService with real scanner and store', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'repository-ledger-e2e-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('scans real repositories into the JSON store and carries discoveredAt across refreshes', async () => {
    await mkdir(join(tempRoot, 'root', 'a', '.git'), { recursive: true });
    await mkdir(join(tempRoot, 'root', 'b', '.git'), { recursive: true });
    const root = join(tempRoot, 'root');
    const ledgerPath = join(tempRoot, 'state', 'repository-ledger.json');
    let clock = 0;
    const ports: RepositoryLedgerPorts = {
      fetchRoots: vi.fn(async () => [root]),
      scan: (roots) => scanRepositories({ roots }),
      store: createRepositoryLedgerStore(ledgerPath),
      now: () => {
        clock += 1;
        return clock;
      },
      reportSnapshot: vi.fn(async () => ({ ok: true })),
    };
    const service = createRepositoryLedgerService(ports);

    await service.refresh('boot');
    const first = JSON.parse(await readFile(ledgerPath, 'utf8')) as StoredLedger;

    expect(first.roots).toEqual([root]);
    expect(first.entries.map((entry) => entry.path).sort()).toEqual([
      join(root, 'a'),
      join(root, 'b'),
    ]);
    const discoveredA = first.entries.find((entry) => entry.path === join(root, 'a'))?.discoveredAt;
    expect(discoveredA).toBe(1);

    await rm(join(root, 'b', '.git'), { recursive: true, force: true });

    await service.refresh('roots-changed');
    const second = JSON.parse(await readFile(ledgerPath, 'utf8')) as StoredLedger;

    expect(second.entries.map((entry) => entry.path)).toEqual([join(root, 'a')]);
    expect(second.entries[0]?.discoveredAt).toBe(discoveredA);
  });

  it('reports a ledger already on disk without scanning', async () => {
    const root = join(tempRoot, 'root');
    await mkdir(join(root, 'a', '.git'), { recursive: true });
    const ledgerPath = join(tempRoot, 'state', 'repository-ledger.json');
    const store = createRepositoryLedgerStore(ledgerPath);
    await store.write({
      version: 1,
      generatedAt: 777,
      roots: [root],
      rootStatuses: [{ path: root, status: 'ok', repositoryCount: 1 }],
      truncated: false,
      entries: [
        {
          path: join(root, 'a'),
          name: 'a',
          root,
          branch: null,
          remoteUrl: null,
          discoveredAt: 700,
        },
      ],
    });
    const scan = vi.fn(() => scanRepositories({ roots: [root] }));
    const reportSnapshot = vi.fn(async (_report: RepositoryLedgerSnapshotReport) => ({ ok: true }));
    const service = createRepositoryLedgerService({
      fetchRoots: vi.fn(async () => [root]),
      scan,
      store,
      now: () => 999,
      reportSnapshot,
    });

    service.serveSnapshot({ requestId: REQUEST_ID, rescan: false });

    await vi.waitFor(() => expect(reportSnapshot).toHaveBeenCalledTimes(1));
    expect(scan).not.toHaveBeenCalled();
    expect(reportSnapshot.mock.calls[0]?.[0]).toEqual({
      requestId: REQUEST_ID,
      status: 'completed',
      entries: [
        {
          path: join(root, 'a'),
          name: 'a',
          root,
          discoveredAt: 700,
        },
      ],
      truncated: false,
      roots: [{ path: root, status: 'ok', repositoryCount: 1 }],
      ledgerGeneratedAt: 777,
    });
  });
});
