import { exec } from 'node:child_process';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEntries, isExcluded, scanFileTree } from './file-tree-scanner.js';

const mocks = vi.hoisted(() => ({
  isGitRepo: vi.fn(),
  walkWorkspaceFiles: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: Function) => fn,
}));

vi.mock('../../git/git-reader.js', () => ({
  isGitRepo: mocks.isGitRepo,
}));

vi.mock('./workspace-file-walk.js', () => ({
  walkWorkspaceFiles: mocks.walkWorkspaceFiles,
}));

const mockExec = vi.mocked(exec);

function mockSuccess(stdout: string): void {
  mockExec.mockImplementationOnce((_cmd, _opts) => {
    return Promise.resolve({ stdout, stderr: '' }) as unknown as ReturnType<typeof exec>;
  });
}

describe('isExcluded', () => {
  it('excludes node_modules paths', () => {
    expect(isExcluded('node_modules/foo/bar.js')).toBe(true);
    expect(isExcluded('src/node_modules/pkg.js')).toBe(true);
  });

  it('excludes .git paths', () => {
    expect(isExcluded('.git/config')).toBe(true);
  });

  it('excludes dist, build, .next, coverage', () => {
    expect(isExcluded('dist/index.js')).toBe(true);
    expect(isExcluded('build/output.js')).toBe(true);
    expect(isExcluded('.next/static/chunks/main.js')).toBe(true);
    expect(isExcluded('coverage/lcov.info')).toBe(true);
  });

  it('does not exclude normal paths', () => {
    expect(isExcluded('src/index.ts')).toBe(false);
    expect(isExcluded('packages/cli/src/main.ts')).toBe(false);
    expect(isExcluded('README.md')).toBe(false);
  });

  it('excludes .turbo paths', () => {
    expect(isExcluded('.turbo/cache/abc.json')).toBe(true);
  });
});

describe('buildEntries', () => {
  it('creates file and directory entries from paths', () => {
    const paths = ['src/index.ts', 'src/utils/helper.ts', 'README.md'];
    const entries = buildEntries(paths, 100);

    const dirs = entries.filter((e) => e.type === 'directory');
    const files = entries.filter((e) => e.type === 'file');

    expect(dirs).toHaveLength(2);
    expect(dirs.map((d) => d.path).sort()).toEqual(['src', 'src/utils']);
    expect(files).toHaveLength(3);
  });

  it('caps entries at maxEntries', () => {
    const paths = Array.from({ length: 100 }, (_, i) => `file${i}.ts`);
    const entries = buildEntries(paths, 50);
    expect(entries).toHaveLength(50);
  });

  it('returns empty array for empty input', () => {
    const entries = buildEntries([], 100);
    expect(entries).toHaveLength(0);
  });

  it('sorts entries alphabetically', () => {
    const paths = ['z.ts', 'a.ts', 'm/b.ts'];
    const entries = buildEntries(paths, 100);
    const dirs = entries.filter((e) => e.type === 'directory');
    const files = entries.filter((e) => e.type === 'file');

    expect(dirs[0].path).toBe('m');
    expect(files[0].path).toBe('a.ts');
    expect(files[1].path).toBe('m/b.ts');
    expect(files[2].path).toBe('z.ts');
  });
});

describe('scanFileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isGitRepo.mockResolvedValue(true);
    mocks.walkWorkspaceFiles.mockResolvedValue({ filePaths: [], truncated: false });
  });

  it('returns file tree with entries from git ls-files', async () => {
    mockSuccess('src/index.ts\nREADME.md\n');
    mockSuccess('draft.txt\n');

    const tree = await scanFileTree('/test/repo');

    expect(tree.rootDir).toBe('/test/repo');
    expect(tree.scannedAt).toBeGreaterThan(0);

    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);
    expect(filePaths).toContain('src/index.ts');
    expect(filePaths).toContain('README.md');
    expect(filePaths).toContain('draft.txt');
    expect(mocks.walkWorkspaceFiles).not.toHaveBeenCalled();
  });

  it('deduplicates tracked and untracked files', async () => {
    mockSuccess('src/index.ts\n');
    mockSuccess('src/index.ts\n');

    const tree = await scanFileTree('/test/repo');
    const files = tree.entries.filter((e) => e.type === 'file');
    expect(files).toHaveLength(1);
  });

  it('filters out excluded paths', async () => {
    mockSuccess('src/app.ts\nnode_modules/pkg/index.js\ndist/bundle.js\n');
    mockSuccess('');

    const tree = await scanFileTree('/test/repo');
    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);

    expect(filePaths).toContain('src/app.ts');
    expect(filePaths).not.toContain('node_modules/pkg/index.js');
    expect(filePaths).not.toContain('dist/bundle.js');
  });

  it('caps at maxEntries', async () => {
    const manyFiles = Array.from({ length: 200 }, (_, i) => `file${i}.ts`).join('\n');
    mockSuccess(manyFiles);
    mockSuccess('');

    const tree = await scanFileTree('/test/repo', { maxEntries: 50 });
    expect(tree.entries.length).toBeLessThanOrEqual(50);
  });

  it('falls back to filesystem walk when not a git repo', async () => {
    mocks.isGitRepo.mockResolvedValue(false);
    mocks.walkWorkspaceFiles.mockResolvedValue({
      filePaths: ['src/index.ts'],
      truncated: false,
    });

    const tree = await scanFileTree('/not/a/repo');

    expect(mocks.walkWorkspaceFiles).toHaveBeenCalledWith('/not/a/repo', { maxFilePaths: 10_000 });
    expect(tree.entries.filter((e) => e.type === 'file').map((e) => e.path)).toContain(
      'src/index.ts'
    );
    expect(mockExec).not.toHaveBeenCalled();
  });
});
