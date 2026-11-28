import { mkdir, mkdtemp, opendir, rm, stat, symlink, writeFile } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { homedir, platform, tmpdir } from 'node:os';
import type * as Os from 'node:os';
import { dirname, join } from 'node:path';

import {
  FOLDER_BROWSE_MAX_ENTRIES,
  FOLDER_BROWSE_MAX_NAME_BYTES,
  folderBrowseNameBytes,
} from '@workspace/shared/domain/folder-browse';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LIST_LIMITS, listBrowseDirectory } from './list-browse-directory.js';

const realFs = vi.hoisted(() => ({
  opendir: undefined as unknown as typeof FsPromises.opendir,
  stat: undefined as unknown as typeof FsPromises.stat,
  platform: undefined as unknown as typeof Os.platform,
  homedir: undefined as unknown as typeof Os.homedir,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();
  realFs.opendir = actual.opendir;
  realFs.stat = actual.stat;
  return { ...actual, opendir: vi.fn(actual.opendir), stat: vi.fn(actual.stat) };
});

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof Os>();
  realFs.platform = actual.platform;
  realFs.homedir = actual.homedir;
  return { ...actual, platform: vi.fn(actual.platform), homedir: vi.fn(actual.homedir) };
});

beforeEach(() => {
  vi.mocked(opendir).mockImplementation(realFs.opendir);
  vi.mocked(stat).mockImplementation(realFs.stat);
  vi.mocked(platform).mockImplementation(() => 'darwin');
  vi.mocked(homedir).mockImplementation(realFs.homedir);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Real temp directory with directories, files and symlinks. Caller removes it. */
async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'chatroom-browse-'));
  for (const name of ['alpha', 'Beta', 'gamma2', 'gamma10', 'zeta', '.hidden-dir']) {
    await mkdir(join(root, name));
  }
  await writeFile(join(root, 'notes.md'), 'x');
  await writeFile(join(root, 'file.txt'), 'x');
  await writeFile(join(root, '.hidden-file'), 'x');
  await symlink(join(root, 'alpha'), join(root, 'sym-alpha'), 'dir');
  await symlink(join(root, 'file.txt'), join(root, 'sym-file'), 'file');
  await symlink(join(root, 'does-not-exist'), join(root, 'sym-dangling'), 'file');
  return root;
}

function permissionError(message: string): Error {
  return Object.assign(new Error(message), { code: 'EACCES' });
}

/** Minimal async-iterable stand-in for `opendir`'s Dir handle. */
function fakeDir(
  entries: { name: string; isDirectory: () => boolean; isSymbolicLink: () => boolean }[]
) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const entry of entries) yield entry;
    },
    close: async () => {},
  };
}

describe('listBrowseDirectory', () => {
  it('lists directories only with hidden entries counted', async () => {
    const root = await createFixture();
    try {
      const result = await listBrowseDirectory({ path: root, showHidden: false, filter: null });

      expect(result).toMatchObject({
        kind: 'listing',
        path: root,
        parentPath: dirname(root),
        dirCount: 6,
        fileCount: 4,
        hiddenCount: 2,
        complete: true,
      });
      if (result.kind !== 'listing') throw new Error('expected listing');
      expect(result.entries.map((entry) => entry.name)).toEqual([
        'alpha',
        'Beta',
        'gamma2',
        'gamma10',
        'sym-alpha',
        'zeta',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('includes and recounts hidden entries when showHidden is true', async () => {
    const root = await createFixture();
    try {
      const result = await listBrowseDirectory({ path: root, showHidden: true, filter: null });

      if (result.kind !== 'listing') throw new Error('expected listing');
      const names = result.entries.map((entry) => entry.name);
      expect(names).toContain('.hidden-dir');
      expect(names).not.toContain('.hidden-file');
      expect(result).toMatchObject({ dirCount: 7, fileCount: 5, hiddenCount: 0 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('flags a symlinked directory and leaves a real directory unflagged', async () => {
    const root = await createFixture();
    try {
      const result = await listBrowseDirectory({ path: root, showHidden: false, filter: null });

      if (result.kind !== 'listing') throw new Error('expected listing');
      expect(result.entries).toContainEqual({ name: 'sym-alpha', symlink: true });
      const alpha = result.entries.find((entry) => entry.name === 'alpha');
      expect(alpha).toEqual({ name: 'alpha' });
      expect(alpha).not.toHaveProperty('symlink');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('sorts naturally by number', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chatroom-browse-'));
    try {
      await mkdir(join(root, 'v10'));
      await mkdir(join(root, 'v2'));

      const result = await listBrowseDirectory({ path: root, showHidden: false, filter: null });

      if (result.kind !== 'listing') throw new Error('expected listing');
      expect(result.entries.map((entry) => entry.name)).toEqual(['v2', 'v10']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('applies a case-insensitive substring filter to directory names', async () => {
    const root = await createFixture();
    try {
      const gamma = await listBrowseDirectory({ path: root, showHidden: false, filter: 'GA' });
      expect(gamma).toMatchObject({ kind: 'listing', dirCount: 2 });
      if (gamma.kind !== 'listing') throw new Error('expected listing');
      expect(gamma.entries.map((entry) => entry.name)).toEqual(['gamma2', 'gamma10']);

      const alpha = await listBrowseDirectory({ path: root, showHidden: false, filter: 'ALP' });
      expect(alpha).toMatchObject({ kind: 'listing', dirCount: 2 });
      if (alpha.kind !== 'listing') throw new Error('expected listing');
      expect(alpha.entries.map((entry) => entry.name)).toEqual(['alpha', 'sym-alpha']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('truncates by the entry cap', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chatroom-browse-'));
    try {
      for (let index = 0; index <= 504; index += 1) {
        await mkdir(join(root, `dir-${String(index).padStart(3, '0')}`));
      }

      const result = await listBrowseDirectory({ path: root, showHidden: false, filter: null });

      if (result.kind !== 'listing') throw new Error('expected listing');
      expect(result.entries).toHaveLength(FOLDER_BROWSE_MAX_ENTRIES);
      expect(result.entries[0]?.name).toBe('dir-000');
      expect(result.dirCount).toBe(505);
      expect(result.complete).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('truncates by the name-byte budget', async () => {
    const root = await mkdtemp(join(tmpdir(), 'chatroom-browse-'));
    try {
      for (let index = 0; index < 400; index += 1) {
        await mkdir(join(root, `${'d'.repeat(195)}${String(index).padStart(5, '0')}`));
      }

      const result = await listBrowseDirectory({ path: root, showHidden: false, filter: null });

      if (result.kind !== 'listing') throw new Error('expected listing');
      expect(result.entries.length).toBeLessThan(400);
      expect(folderBrowseNameBytes(result.entries)).toBeLessThanOrEqual(
        FOLDER_BROWSE_MAX_NAME_BYTES
      );
      expect(folderBrowseNameBytes(result.entries) + 200).toBeGreaterThan(
        FOLDER_BROWSE_MAX_NAME_BYTES
      );
      expect(result.dirCount).toBe(400);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('falls back to the nearest existing ancestor', async () => {
    const root = await createFixture();
    try {
      const missing = await listBrowseDirectory({
        path: join(root, 'ghost', 'deeper'),
        showHidden: false,
        filter: null,
      });
      expect(missing).toMatchObject({ kind: 'listing', path: root });
      if (missing.kind !== 'listing') throw new Error('expected listing');
      expect(missing.entries.length).toBeGreaterThan(0);

      const file = await listBrowseDirectory({
        path: join(root, 'file.txt'),
        showHidden: false,
        filter: null,
      });
      expect(file).toMatchObject({ kind: 'listing', path: root });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports a null parent at the filesystem root', async () => {
    const result = await listBrowseDirectory({ path: '/', showHidden: false, filter: null });

    expect(result).toMatchObject({ kind: 'listing', path: '/', parentPath: null });
  });

  it('starts at the home directory when no path is given', async () => {
    const root = await createFixture();
    try {
      vi.mocked(homedir).mockReturnValue(root);

      const result = await listBrowseDirectory({ path: null, showHidden: false, filter: null });

      expect(result).toMatchObject({ kind: 'listing', path: root });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports PERMISSION_DENIED when the path cannot be inspected', async () => {
    vi.mocked(stat).mockRejectedValue(permissionError('EACCES: permission denied'));

    const result = await listBrowseDirectory({
      path: '/private/blocked',
      showHidden: false,
      filter: null,
    });

    expect(result).toMatchObject({
      kind: 'error',
      code: 'PERMISSION_DENIED',
      path: '/private/blocked',
    });
    if (result.kind !== 'error') throw new Error('expected error');
    expect(result.message).toContain('permission denied');
  });

  it('reports PERMISSION_DENIED when the directory cannot be opened', async () => {
    const root = await createFixture();
    try {
      vi.mocked(opendir).mockRejectedValueOnce(permissionError('EACCES: permission denied'));

      const result = await listBrowseDirectory({ path: root, showHidden: false, filter: null });

      expect(result).toMatchObject({ kind: 'error', code: 'PERMISSION_DENIED', path: root });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports READ_FAILED for a non-permission read error', async () => {
    const root = await createFixture();
    try {
      vi.mocked(opendir).mockRejectedValueOnce(
        Object.assign(new Error('I/O error'), { code: 'EIO' })
      );

      const result = await listBrowseDirectory({ path: root, showHidden: false, filter: null });

      expect(result).toMatchObject({ kind: 'error', code: 'READ_FAILED', message: 'I/O error' });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports TIMEOUT when the listing hangs', async () => {
    const root = await createFixture();
    try {
      vi.useFakeTimers();
      vi.mocked(opendir).mockReturnValue(new Promise(() => {}) as never);

      const promise = listBrowseDirectory({ path: root, showHidden: false, filter: null });
      await vi.advanceTimersByTimeAsync(LIST_LIMITS.hardTimeoutMs);

      await expect(promise).resolves.toMatchObject({ kind: 'error', code: 'TIMEOUT', path: root });
    } finally {
      vi.useRealTimers();
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports UNSUPPORTED_PLATFORM on win32', async () => {
    vi.mocked(platform).mockReturnValue('win32');

    const result = await listBrowseDirectory({
      path: '/tmp/anywhere',
      showHidden: false,
      filter: null,
    });

    expect(result).toMatchObject({
      kind: 'error',
      code: 'UNSUPPORTED_PLATFORM',
      path: '/tmp/anywhere',
    });
  });

  it('marks the listing incomplete at the scan cap', async () => {
    const root = await createFixture();
    try {
      const entries = Array.from({ length: 20_001 }, (_, index) => ({
        name: `dir-${String(index).padStart(5, '0')}`,
        isDirectory: () => true,
        isSymbolicLink: () => false,
      }));
      vi.mocked(opendir).mockResolvedValue(fakeDir(entries) as never);

      const result = await listBrowseDirectory({ path: root, showHidden: false, filter: null });

      if (result.kind !== 'listing') throw new Error('expected listing');
      expect(result.entries).toHaveLength(FOLDER_BROWSE_MAX_ENTRIES);
      expect(result.dirCount).toBe(LIST_LIMITS.scanMaxEntries);
      expect(result.complete).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
