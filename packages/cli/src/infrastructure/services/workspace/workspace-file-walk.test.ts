import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { walkWorkspaceFiles } from './workspace-file-walk.js';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ spawn: spawnMock }));

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

  it('respects nested .gitignore rules without requiring a git repository', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-walk-nested-ignore-'));
    await mkdir(join(tmpDir, 'packages', 'app', 'generated'), { recursive: true });
    await writeFile(join(tmpDir, 'packages', '.gitignore'), 'generated/\n*.tmp\n');
    await writeFile(join(tmpDir, 'packages', 'app', 'generated', 'output.ts'), 'ignored');
    await writeFile(join(tmpDir, 'packages', 'app', 'scratch.tmp'), 'ignored');
    await writeFile(join(tmpDir, 'packages', 'app', 'index.ts'), 'visible');

    const result = await walkWorkspaceFiles(tmpDir);

    expect(result.filePaths).toContain('packages/app/index.ts');
    expect(result.filePaths).not.toContain('packages/app/generated/output.ts');
    expect(result.filePaths).not.toContain('packages/app/scratch.tmp');
  });

  it('does not walk shallow-sync directories but keeps a directory stub', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-walk-exclude-'));
    await mkdir(join(tmpDir, 'node_modules'));
    await writeFile(join(tmpDir, 'node_modules', 'pkg.js'), 'x');
    await writeFile(join(tmpDir, 'app.ts'), 'app');

    const result = await walkWorkspaceFiles(tmpDir);

    expect(result.filePaths).toEqual(['app.ts']);
    expect(result.directoryStubs).toContain('node_modules');
  });

  it('includes empty application directories such as .gdp', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-walk-gdp-'));
    await mkdir(join(tmpDir, '.gdp'));
    await writeFile(join(tmpDir, '.drone.yml'), 'kind: pipeline');

    const result = await walkWorkspaceFiles(tmpDir);

    expect(result.directoryStubs).toContain('.gdp');
    expect(result.filePaths).toContain('.drone.yml');
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

  it('walks into nested directories such as git submodule mount points', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-walk-submodule-'));
    await mkdir(join(tmpDir, 'vendor', 'my-lib', 'src'), { recursive: true });
    await writeFile(join(tmpDir, 'vendor', 'my-lib', 'README.md'), '# lib');
    await writeFile(join(tmpDir, 'vendor', 'my-lib', 'src', 'index.ts'), 'export {}');

    const result = await walkWorkspaceFiles(tmpDir);

    expect(result.filePaths.sort()).toEqual([
      'vendor/my-lib/README.md',
      'vendor/my-lib/src/index.ts',
    ]);
  });

  it('does not launch git while walking a large git-shaped workspace', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'file-walk-no-git-'));
    await mkdir(join(tmpDir, '.git'));
    await mkdir(join(tmpDir, 'src'));
    await Promise.all(
      Array.from({ length: 500 }, (_, index) =>
        writeFile(join(tmpDir, 'src', `file-${index}.ts`), `export const n = ${index};`)
      )
    );

    const result = await walkWorkspaceFiles(tmpDir);

    expect(result.filePaths).toHaveLength(500);
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
