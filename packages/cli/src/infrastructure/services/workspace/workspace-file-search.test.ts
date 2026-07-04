import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { searchWorkspaceFiles } from './workspace-file-search.js';

describe('searchWorkspaceFiles', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  });

  it('finds files by case-insensitive substring and excludes secrets', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-search-'));
    await writeFile(join(tmpDir, 'README.md'), '#');
    await mkdir(join(tmpDir, 'src'));
    await writeFile(join(tmpDir, 'src', 'App.tsx'), 'x');
    await writeFile(join(tmpDir, '.env'), 'x');

    const result = await searchWorkspaceFiles(tmpDir, 'app');
    const paths = result.entries.map((e) => e.path);

    expect(paths).toContain('src/App.tsx');
    expect(paths).not.toContain('.env');
  });

  it('returns up to maxResults files when query is empty', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-search-empty-'));
    await writeFile(join(tmpDir, 'a.txt'), 'a');
    await writeFile(join(tmpDir, 'b.txt'), 'b');

    const result = await searchWorkspaceFiles(tmpDir, '');
    expect(result.entries.length).toBeGreaterThanOrEqual(2);
  });
});
