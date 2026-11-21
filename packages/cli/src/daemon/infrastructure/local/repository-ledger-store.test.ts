import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { StoredLedger } from './repository-ledger-store.js';
import { createRepositoryLedgerStore } from './repository-ledger-store.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'repository-ledger-store-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

function makeLedger(overrides: Partial<StoredLedger> = {}): StoredLedger {
  return {
    version: 1,
    generatedAt: 1_700_000_000_000,
    roots: ['/Users/test/projects'],
    rootStatuses: [{ path: '/Users/test/projects', status: 'ok', repositoryCount: 1 }],
    truncated: false,
    entries: [
      {
        path: '/Users/test/projects/alpha',
        name: 'alpha',
        root: '/Users/test/projects',
        branch: 'main',
        remoteUrl: 'https://github.com/acme/alpha.git',
        discoveredAt: 1_700_000_000_000,
      },
    ],
    ...overrides,
  };
}

function tmpFilesIn(dir: string): string[] {
  return readdirSync(dir).filter((name) => name.includes('.tmp-'));
}

describe('createRepositoryLedgerStore write/read', () => {
  it('round-trips a ledger', async () => {
    const filePath = join(workDir, 'ledger.json');
    const store = createRepositoryLedgerStore(filePath);
    const ledger = makeLedger();

    await store.write(ledger);

    await expect(store.read()).resolves.toEqual(ledger);
  });

  it('creates missing parent directories', async () => {
    const filePath = join(workDir, 'nested', 'deeper', 'ledger.json');
    const store = createRepositoryLedgerStore(filePath);
    const ledger = makeLedger();

    await store.write(ledger);

    await expect(store.read()).resolves.toEqual(ledger);
  });

  it.skipIf(process.platform === 'win32')('writes the file with mode 0o600', async () => {
    const filePath = join(workDir, 'mode.json');
    const store = createRepositoryLedgerStore(filePath);

    await store.write(makeLedger());

    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === 'win32')(
    'tightens an existing 0o644 file to 0o600 on overwrite',
    async () => {
      const filePath = join(workDir, 'overwrite.json');
      writeFileSync(filePath, JSON.stringify(makeLedger()), { mode: 0o644 });
      const store = createRepositoryLedgerStore(filePath);

      await store.write(makeLedger({ truncated: true }));

      expect(statSync(filePath).mode & 0o777).toBe(0o600);
      await expect(store.read()).resolves.toMatchObject({ truncated: true });
    }
  );

  it('leaves no temporary file behind after a successful write', async () => {
    const filePath = join(workDir, 'clean.json');
    const store = createRepositoryLedgerStore(filePath);

    await store.write(makeLedger());

    expect(tmpFilesIn(dirname(filePath))).toEqual([]);
  });
});

describe('createRepositoryLedgerStore read failures', () => {
  it('returns null for a missing file', async () => {
    const store = createRepositoryLedgerStore(join(workDir, 'absent.json'));

    await expect(store.read()).resolves.toBeNull();
  });

  it.each([
    ['garbage text', 'not json at all'],
    ['unknown version', JSON.stringify({ ...makeLedger(), version: 2 })],
    ['a JSON array', JSON.stringify([makeLedger()])],
    ['a version-1 document with bad shape', JSON.stringify({ ...makeLedger(), roots: 'nope' })],
    ['a version-1 document missing entries', JSON.stringify({ ...makeLedger(), entries: null })],
  ])('returns null for %s', async (_label, contents) => {
    const filePath = join(workDir, 'corrupt.json');
    writeFileSync(filePath, contents);
    const store = createRepositoryLedgerStore(filePath);

    await expect(store.read()).resolves.toBeNull();
  });
});

describe('createRepositoryLedgerStore clear', () => {
  it('removes the ledger file', async () => {
    const filePath = join(workDir, 'clear.json');
    const store = createRepositoryLedgerStore(filePath);
    await store.write(makeLedger());

    await store.clear();

    await expect(store.read()).resolves.toBeNull();
  });

  it('does not throw when the file is missing', async () => {
    const store = createRepositoryLedgerStore(join(workDir, 'never-written.json'));

    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe('createRepositoryLedgerStore atomicity', () => {
  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'keeps the previous ledger readable when the write fails',
    async () => {
      const dir = join(workDir, 'readonly');
      mkdirSync(dir);
      const filePath = join(dir, 'ledger.json');
      const store = createRepositoryLedgerStore(filePath);
      const original = makeLedger();
      await store.write(original);

      chmodSync(dir, 0o500);
      try {
        await expect(store.write(makeLedger({ truncated: true }))).rejects.toThrow();
      } finally {
        chmodSync(dir, 0o755);
      }

      await expect(store.read()).resolves.toEqual(original);
      expect(tmpFilesIn(dir)).toEqual([]);
    }
  );

  it('rejects when the target path is a directory and leaves no temporary file', async () => {
    const filePath = join(workDir, 'target-is-a-dir.json');
    mkdirSync(filePath);
    const store = createRepositoryLedgerStore(filePath);

    await expect(store.write(makeLedger())).rejects.toThrow();

    expect(tmpFilesIn(dirname(filePath))).toEqual([]);
  });
});
