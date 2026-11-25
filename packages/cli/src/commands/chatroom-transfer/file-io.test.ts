/**
 * `file-io` tests.
 *
 * The atomic publisher is exercised at the `ChatroomTransferFs` seam: an
 * in-memory fake proves the algorithm (ordering, cleanup, `EEXIST` mapping),
 * and the real node adapter proves the POSIX modes and the no-overwrite
 * guarantee on disk.
 */

import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ChatroomTransferError } from '@workspace/backend/src/domain/entities/chatroom-transfer-file';
import { afterEach, describe, expect, it } from 'vitest';

import type { ChatroomTransferFs } from './deps.js';
import {
  createNodeChatroomTransferFs,
  exportFileName,
  writeExportFileAtomically,
} from './file-io.js';

const DIR = '/work/out';
const NAME = 'chatroom-abc-20261125T130405Z.json';
const CONTENT = '{"hello":"world"}';

/** One errno-shaped failure, the way `node:fs` reports a failed syscall. */
function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(code) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

interface FakeFsOptions {
  /** Make `writeExclusive` fail, either as a foreign file (`exists`) or mid-write (`partial`). */
  failWrite?: 'exists' | 'partial' | undefined;
  /** Make `link` fail with `EEXIST` or another errno. */
  failLink?: 'exists' | 'other' | undefined;
}

/** In-memory `ChatroomTransferFs`: records every call and models the failure modes. */
class FakeChatroomTransferFs implements ChatroomTransferFs {
  readonly files = new Map<string, string>();
  readonly dirs: { path: string; mode: number }[] = [];
  readonly writes: { path: string; data: string; mode: number }[] = [];
  readonly links: { existing: string; newPath: string }[] = [];

  constructor(private readonly options: FakeFsOptions = {}) {}

  async mkdirp(path: string, mode: number): Promise<void> {
    this.dirs.push({ path, mode });
  }

  async writeExclusive(path: string, data: string, mode: number): Promise<void> {
    this.writes.push({ path, data, mode });
    if (this.options.failWrite === 'exists') throw errnoError('EEXIST');
    if (this.options.failWrite === 'partial') {
      this.files.set(path, data.slice(0, 1));
      throw errnoError('ENOSPC');
    }
    if (this.files.has(path)) throw errnoError('EEXIST');
    this.files.set(path, data);
  }

  async link(existing: string, newPath: string): Promise<void> {
    this.links.push({ existing, newPath });
    if (this.options.failLink === 'exists') throw errnoError('EEXIST');
    if (this.options.failLink === 'other') throw errnoError('EACCES');
    if (this.files.has(newPath)) throw errnoError('EEXIST');
    const data = this.files.get(existing);
    if (data === undefined) throw errnoError('ENOENT');
    this.files.set(newPath, data);
  }

  async unlink(path: string): Promise<void> {
    if (!this.files.delete(path)) throw errnoError('ENOENT');
  }

  async readFile(path: string): Promise<string> {
    const data = this.files.get(path);
    if (data === undefined) throw errnoError('ENOENT');
    return data;
  }

  async stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean; size: number }> {
    const data = this.files.get(path);
    return {
      isFile: data !== undefined,
      isDirectory: this.dirs.some((dir) => dir.path === path),
      size: data?.length ?? 0,
    };
  }
}

/** Every leftover temp name in the fake's file map. */
function tempNames(fs: FakeChatroomTransferFs): string[] {
  return [...fs.files.keys()].filter((path) => path.endsWith('.tmp'));
}

describe('exportFileName', () => {
  it('formats the UTC timestamp without colons', () => {
    expect(exportFileName('abc', new Date('2026-11-25T13:04:05Z'))).toBe(
      'chatroom-abc-20261125T130405Z.json'
    );
  });
});

describe('writeExportFileAtomically (in-memory fs)', () => {
  it('publishes the exact content with directory 0o700 and file 0o600', async () => {
    const fs = new FakeChatroomTransferFs();

    const published = await writeExportFileAtomically(fs, DIR, NAME, CONTENT);

    const final = join(DIR, NAME);
    expect(published).toBe(final);
    expect(fs.files.get(final)).toBe(CONTENT);
    expect(fs.dirs).toEqual([{ path: DIR, mode: 0o700 }]);
    expect(fs.writes).toEqual([
      { path: join(DIR, `.${NAME}.${process.pid}.tmp`), data: CONTENT, mode: 0o600 },
    ]);
    expect(tempNames(fs)).toEqual([]);
  });

  it('refuses an existing final name without touching it or leaving a temp file', async () => {
    const fs = new FakeChatroomTransferFs({ failLink: 'exists' });
    const final = join(DIR, NAME);
    fs.files.set(final, 'original');

    await expect(writeExportFileAtomically(fs, DIR, NAME, CONTENT)).rejects.toMatchObject({
      code: 'EXPORT_FILE_EXISTS',
      message: `file already exists: ${final}; choose another --path or wait a second`,
    });
    expect(fs.files.get(final)).toBe('original');
    expect(tempNames(fs)).toEqual([]);
  });

  it('removes a partially written temp file when writeExclusive fails mid-write', async () => {
    const fs = new FakeChatroomTransferFs({ failWrite: 'partial' });

    await expect(writeExportFileAtomically(fs, DIR, NAME, CONTENT)).rejects.toMatchObject({
      code: 'ENOSPC',
    });
    expect(tempNames(fs)).toEqual([]);
  });

  it('rethrows a non-EEXIST link failure and leaves no temp file', async () => {
    const fs = new FakeChatroomTransferFs({ failLink: 'other' });

    await expect(writeExportFileAtomically(fs, DIR, NAME, CONTENT)).rejects.toMatchObject({
      code: 'EACCES',
    });
    expect(tempNames(fs)).toEqual([]);
  });

  it('does not unlink a temp path that the exclusive create refused to own', async () => {
    const fs = new FakeChatroomTransferFs({ failWrite: 'exists' });
    const tmp = join(DIR, `.${NAME}.${process.pid}.tmp`);
    fs.files.set(tmp, 'another-writer');

    await expect(writeExportFileAtomically(fs, DIR, NAME, CONTENT)).rejects.toMatchObject({
      code: 'EEXIST',
    });
    expect(fs.files.get(tmp)).toBe('another-writer');
  });

  it('wraps the EEXIST name clash in a ChatroomTransferError', async () => {
    const fs = new FakeChatroomTransferFs({ failLink: 'exists' });
    fs.files.set(join(DIR, NAME), 'original');

    await expect(writeExportFileAtomically(fs, DIR, NAME, CONTENT)).rejects.toBeInstanceOf(
      ChatroomTransferError
    );
  });
});

/** Temp directories the real-disk tests create. */
const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'chatroom-transfer-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Temp names in a real directory. */
async function tempEntries(dir: string): Promise<string[]> {
  const entries = await readdir(dir);
  return entries.filter((entry) => entry.endsWith('.tmp'));
}

describe.skipIf(process.platform === 'win32')('writeExportFileAtomically (real disk)', () => {
  it('creates a 0o700 directory and a 0o600 file with the exact bytes', async () => {
    const root = await makeTempDir();
    const dir = join(root, 'nested', 'exports');
    const published = await writeExportFileAtomically(
      createNodeChatroomTransferFs(),
      dir,
      NAME,
      CONTENT
    );

    expect(published).toBe(join(dir, NAME));
    expect((await stat(dir)).mode & 0o777).toBe(0o700);
    expect((await stat(published)).mode & 0o777).toBe(0o600);
    expect(await readFile(published, 'utf8')).toBe(CONTENT);
    expect(await tempEntries(dir)).toEqual([]);
  });

  it('refuses a second publish to the same name and keeps the first bytes', async () => {
    const root = await makeTempDir();
    const dir = join(root, 'exports');
    const fs = createNodeChatroomTransferFs();
    const published = await writeExportFileAtomically(fs, dir, NAME, 'first');

    await expect(writeExportFileAtomically(fs, dir, NAME, 'second')).rejects.toMatchObject({
      code: 'EXPORT_FILE_EXISTS',
    });

    expect(await readFile(published, 'utf8')).toBe('first');
    expect(await tempEntries(dir)).toEqual([]);
  });
});
