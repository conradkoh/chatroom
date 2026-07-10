import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { walkWorkspaceFiles } from './workspace-file-walk.js';

describe('walkWorkspaceFiles', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns files from a non-git directory', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-walk-'));
    await mkdir(join(tmpDir, 'src'));
    await writeFile(join(tmpDir, 'README.md'), '# hi');
    await writeFile(join(tmpDir, 'src', 'index.ts'), 'export {}');

    const result = await walkWorkspaceFiles(tmpDir);

    expect(result.truncated).toBe(false);
    expect(result.filePaths.sort()).toEqual(['README.md', 'src/index.ts']);
  });

  it('respects .gitignore', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-walk-ignore-'));
    await writeFile(join(tmpDir, '.gitignore'), 'ignored/\n');
    await mkdir(join(tmpDir, 'ignored'));
    await writeFile(join(tmpDir, 'ignored', 'secret.txt'), 'x');
    await writeFile(join(tmpDir, 'visible.txt'), 'ok');

    const result = await walkWorkspaceFiles(tmpDir);

    expect(result.filePaths.sort()).toEqual(['.gitignore', 'visible.txt']);
    expect(result.filePaths).not.toContain('ignored/secret.txt');
  });

  it('does not walk ALWAYS_EXCLUDE directories', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-walk-exclude-'));
    await mkdir(join(tmpDir, 'node_modules'));
    await writeFile(join(tmpDir, 'node_modules', 'pkg.js'), 'x');
    await writeFile(join(tmpDir, 'app.ts'), 'app');

    const result = await walkWorkspaceFiles(tmpDir);

    expect(result.filePaths).toEqual(['app.ts']);
  });

  it('caps at maxFilePaths', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-walk-cap-'));
    for (let i = 0; i < 5; i++) {
      await writeFile(join(tmpDir, `file${i}.txt`), `${i}`);
    }

    const result = await walkWorkspaceFiles(tmpDir, { maxFilePaths: 3 });

    expect(result.filePaths).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });
});
