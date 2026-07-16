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
    expect(isExcluded('.gdp/config/app.json')).toBe(false);
    expect(isExcluded('.drone.yml')).toBe(false);
  });

  it('does not exclude shallow directory stubs themselves', () => {
    expect(isExcluded('node_modules')).toBe(false);
    expect(isExcluded('dist')).toBe(false);
  });

  it('excludes .turbo paths', () => {
    expect(isExcluded('.turbo/cache/abc.json')).toBe(true);
  });
});

describe('buildEntries', () => {
  it('creates file and directory entries from paths', () => {
    const paths = ['src/index.ts', 'src/utils/helper.ts', 'README.md'];
    const entries = buildEntries(paths, [], 100);

    const dirs = entries.filter((e) => e.type === 'directory');
    const files = entries.filter((e) => e.type === 'file');

    expect(dirs).toHaveLength(2);
    expect(dirs.map((d) => d.path).sort()).toEqual(['src', 'src/utils']);
    expect(files).toHaveLength(3);
  });

  it('includes explicit directory stubs', () => {
    const entries = buildEntries([], ['.gdp', 'node_modules'], 100);
    expect(entries.map((entry) => entry.path)).toEqual(['.gdp', 'node_modules']);
  });

  it('caps entries at maxEntries', () => {
    const paths = Array.from({ length: 100 }, (_, i) => `file${i}.ts`);
    const entries = buildEntries(paths, [], 50);
    expect(entries).toHaveLength(50);
  });

  it('prefers shallow paths when capping so root dotfiles are retained', () => {
    const deepDirs = Array.from({ length: 60 }, (_, i) => `deep/nested/dir${i}`);
    const paths = ['.drone.yml', ...Array.from({ length: 60 }, (_, i) => `deep/file${i}.ts`)];
    const entries = buildEntries(paths, deepDirs, 20);

    expect(entries.some((entry) => entry.path === '.drone.yml')).toBe(true);
  });

  it('returns empty array for empty input', () => {
    const entries = buildEntries([], [], 100);
    expect(entries).toHaveLength(0);
  });

  it('sorts entries by depth then path', () => {
    const paths = ['z.ts', 'a.ts', 'm/b.ts'];
    const entries = buildEntries(paths, [], 100);

    expect(entries.map((entry) => entry.path)).toEqual(['a.ts', 'm', 'z.ts', 'm/b.ts']);
  });
});

describe('scanFileTree', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.walkWorkspaceFiles.mockResolvedValue({
      filePaths: [],
      directoryStubs: [],
      truncated: false,
    });
  });

  it('returns file tree entries from filesystem walk', async () => {
    mocks.walkWorkspaceFiles.mockResolvedValue({
      filePaths: ['src/index.ts', 'README.md', 'draft.txt'],
      directoryStubs: ['src'],
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
      directoryStubs: ['vendor/lib', 'vendor/lib/src'],
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
      directoryStubs: ['node_modules', 'dist'],
      truncated: false,
    });

    const tree = await scanFileTree('/test/repo');
    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);

    expect(filePaths).toContain('src/app.ts');
    expect(filePaths).not.toContain('node_modules/pkg/index.js');
    expect(filePaths).not.toContain('dist/bundle.js');
    expect(tree.entries.some((entry) => entry.path === 'node_modules')).toBe(true);
  });

  it('caps at maxEntries', async () => {
    const manyFiles = Array.from({ length: 200 }, (_, i) => `file${i}.ts`);
    mocks.walkWorkspaceFiles.mockResolvedValue({
      filePaths: manyFiles,
      directoryStubs: [],
      truncated: true,
    });

    const tree = await scanFileTree('/test/repo', { maxEntries: 50 });
    expect(tree.entries.length).toBeLessThanOrEqual(50);
  });
});
