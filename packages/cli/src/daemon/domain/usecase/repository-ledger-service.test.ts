import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRepositoryLedgerService,
  type RepositoryLedgerPorts,
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
    ...overrides,
  };
  return { ports, store };
}

describe('createRepositoryLedgerService', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
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

    await expect(createRepositoryLedgerService(ports).refresh('boot')).resolves.toBeUndefined();

    expect(ports.scan).toHaveBeenCalledWith([ROOT]);
    expect(store.write).toHaveBeenCalledTimes(1);
  });

  it('skips silently when fetching roots fails and nothing is stored', async () => {
    const { ports, store } = createPorts({
      fetchRoots: vi.fn(async () => {
        throw new Error('backend offline');
      }),
    });

    await expect(createRepositoryLedgerService(ports).refresh('boot')).resolves.toBeUndefined();

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

    await expect(Promise.all([first, queued])).resolves.toEqual([undefined, undefined]);
    expect(scan).toHaveBeenCalledTimes(2);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Repository ledger refresh failed')
    );
  });

  it('never reports a snapshot', async () => {
    const { ports } = createPorts();
    const portsWithReport = { ...ports, reportSnapshot: vi.fn() };

    await createRepositoryLedgerService(portsWithReport).refresh('boot');

    expect(portsWithReport.reportSnapshot).not.toHaveBeenCalled();
  });

  it('polls with no timers or filesystem watchers', () => {
    const serviceSource = readFileSync(
      new URL('./repository-ledger-service.ts', import.meta.url),
      'utf8'
    );
    const storeSource = readFileSync(
      new URL('../../infrastructure/local/repository-ledger-store.ts', import.meta.url),
      'utf8'
    );

    for (const source of [serviceSource, storeSource]) {
      expect(source).not.toMatch(/setInterval|setTimeout|fs\.watch|\bwatch\(|chokidar/);
    }
  });
});

describe('createRepositoryLedgerService with real scanner and store', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'repository-ledger-e2e-'));
  });

  afterEach(async () => {
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
});
