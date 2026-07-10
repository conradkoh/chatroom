import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEntries, isExcluded, scanFileTree } from './file-tree-scanner.js';

const mocks = vi.hoisted(() => ({
  walkWorkspaceFiles: vi.fn(),
}));

vi.mock('./workspace-file-walk.js', () => ({
  walkWorkspaceFiles: mocks.walkWorkspaceFiles,
}));

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
    mocks.walkWorkspaceFiles.mockResolvedValue({ filePaths: [], truncated: false });
  });

  it('returns file tree entries from filesystem walk', async () => {
    mocks.walkWorkspaceFiles.mockResolvedValue({
      filePaths: ['src/index.ts', 'README.md', 'draft.txt'],
      truncated: false,
    });

    const tree = await scanFileTree('/test/repo');

    expect(tree.rootDir).toBe('/test/repo');
    expect(tree.scannedAt).toBeGreaterThan(0);
    expect(mocks.walkWorkspaceFiles).toHaveBeenCalledWith('/test/repo', { maxFilePaths: 10_000 });

    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);
    expect(filePaths).toContain('src/index.ts');
    expect(filePaths).toContain('README.md');
    expect(filePaths).toContain('draft.txt');
  });

  it('includes nested files inside submodule-like directories', async () => {
    mocks.walkWorkspaceFiles.mockResolvedValue({
      filePaths: ['vendor/lib/index.ts', 'vendor/lib/src/util.ts'],
      truncated: false,
    });

    const tree = await scanFileTree('/test/repo');
    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);

    expect(filePaths).toContain('vendor/lib/index.ts');
    expect(filePaths).toContain('vendor/lib/src/util.ts');
    expect(tree.entries.some((e) => e.type === 'directory' && e.path === 'vendor/lib')).toBe(true);
    expect(tree.entries.some((e) => e.type === 'directory' && e.path === 'vendor/lib/src')).toBe(
      true
    );
  });

  it('filters out excluded paths', async () => {
    mocks.walkWorkspaceFiles.mockResolvedValue({
      filePaths: ['src/app.ts', 'node_modules/pkg/index.js', 'dist/bundle.js'],
      truncated: false,
    });

    const tree = await scanFileTree('/test/repo');
    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);

    expect(filePaths).toContain('src/app.ts');
    expect(filePaths).not.toContain('node_modules/pkg/index.js');
    expect(filePaths).not.toContain('dist/bundle.js');
  });

  it('caps at maxEntries', async () => {
    const manyFiles = Array.from({ length: 200 }, (_, i) => `file${i}.ts`);
    mocks.walkWorkspaceFiles.mockResolvedValue({
      filePaths: manyFiles,
      truncated: true,
    });

    const tree = await scanFileTree('/test/repo', { maxEntries: 50 });
    expect(tree.entries.length).toBeLessThanOrEqual(50);
  });
});
