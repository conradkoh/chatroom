/**
 * Backup filesystem adapter tests.
 *
 * Real `node:fs` in a temporary directory: symlink detection, the exact SHA-256 of the bytes sent,
 * the size gate and the "missing directory is never created" rule are only observable here.
 * `fetch` is a port (global) and is stubbed per test.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { listBackupDir, statBackupFile, uploadBackupFile } from './user-backups-fs.js';

/** SHA-256 of the three bytes "abc" (a standard test vector). */
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'chatroom-user-backups-'));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

/** Reads a web stream body to completion, as a real upload would. */
async function drain(body: unknown): Promise<void> {
  for await (const _chunk of body as AsyncIterable<unknown>) {
    // Drain only: the adapter hashes while streaming.
  }
}

describe('uploadBackupFile', () => {
  it('streams the file and returns the storage id with the hex SHA-256 of the bytes sent', async () => {
    const path = join(dir, 'backup-20260101-000000.zip');
    await writeFile(path, 'abc');

    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      await drain(init.body);
      return Response.json({ storageId: 'storage-1' });
    });
    vi.stubGlobal('fetch', fetch);

    await expect(
      uploadBackupFile({ path, uploadUrl: 'https://a.convex.site/u', sizeBytes: 3 })
    ).resolves.toEqual({ storageId: 'storage-1', sha256: ABC_SHA256 });

    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-chatroom-machine-backup',
        'Content-Length': '3',
      },
    });
  });

  it('rejects when the upload response is not ok', async () => {
    const path = join(dir, 'backup-20260101-000000.zip');
    await writeFile(path, 'abc');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        await drain(init.body);
        return new Response('', { status: 500 });
      })
    );

    await expect(
      uploadBackupFile({ path, uploadUrl: 'https://a.convex.site/u', sizeBytes: 3 })
    ).rejects.toThrow('Upload failed with status 500');
  });

  it('rejects when the bytes sent differ from the reported size', async () => {
    const path = join(dir, 'backup-20260101-000000.zip');
    await writeFile(path, 'abc');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        await drain(init.body);
        return Response.json({ storageId: 'storage-1' });
      })
    );

    await expect(
      uploadBackupFile({ path, uploadUrl: 'https://a.convex.site/u', sizeBytes: 4 })
    ).rejects.toThrow('Backup size changed while uploading');
  });

  it('rejects when the response has no storage id', async () => {
    const path = join(dir, 'backup-20260101-000000.zip');
    await writeFile(path, 'abc');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: RequestInit) => {
        await drain(init.body);
        return Response.json({ ok: true });
      })
    );

    await expect(
      uploadBackupFile({ path, uploadUrl: 'https://a.convex.site/u', sizeBytes: 3 })
    ).rejects.toThrow('Upload response has no storageId');
  });
});

describe('statBackupFile', () => {
  it('reports a symlink without following it', async () => {
    const target = join(dir, 'target.zip');
    const link = join(dir, 'backup-20260101-000000.zip');
    await writeFile(target, 'abc');
    await symlink(target, link);

    await expect(statBackupFile(link)).resolves.toMatchObject({
      isSymlink: true,
      isFile: false,
    });
  });

  it('reports a regular file', async () => {
    const path = join(dir, 'backup-20260101-000000.zip');
    await writeFile(path, 'abc');

    await expect(statBackupFile(path)).resolves.toMatchObject({
      isSymlink: false,
      isFile: true,
      size: 3,
    });
  });
});

describe('listBackupDir', () => {
  it('rejects with ENOENT for a missing directory and does not create it', async () => {
    const missing = join(dir, 'user-backups');

    await expect(listBackupDir(missing)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(existsSync(missing)).toBe(false);
  });

  it('lists entries with their stat data', async () => {
    await writeFile(join(dir, 'backup-20260101-000000.zip'), 'abc');

    const entries = await listBackupDir(dir);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      name: 'backup-20260101-000000.zip',
      isFile: true,
      isSymlink: false,
      size: 3,
    });
  });
});
