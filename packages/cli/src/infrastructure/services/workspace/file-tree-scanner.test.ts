import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isExcluded, buildEntries } from './file-tree-scanner.js';

// Mock child_process and util before importing scanFileTree
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: Function) => fn,
}));

vi.mock('node:fs/promises', () => ({
  stat: vi.fn(),
}));

import { exec } from 'node:child_process';

const mockExec = vi.mocked(exec);

// Dynamically import scanFileTree after mocks are set up
const { scanFileTree } = await import('./file-tree-scanner.js');

// Helper: mock exec to return success
function mockSuccess(stdout: string): void {
  mockExec.mockImplementationOnce((_cmd, _opts) => {
    return Promise.resolve({ stdout, stderr: '' }) as unknown as ReturnType<typeof exec>;
  });
}

function mockFailure(message: string): void {
  mockExec.mockImplementationOnce(() => {
    return Promise.reject(new Error(message)) as unknown as ReturnType<typeof exec>;
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

  it('excludes .cache, .tmp, tmp, .DS_Store patterns', () => {
    expect(isExcluded('.cache/data.json')).toBe(true);
    expect(isExcluded('.tmp/temp.txt')).toBe(true);
    expect(isExcluded('tmp/backup.zip')).toBe(true);
    expect(isExcluded('.DS_Store')).toBe(true);
  });
});

describe('buildEntries', () => {
  it('creates file and directory entries from paths', () => {
    const paths = ['src/index.ts', 'src/utils/helper.ts', 'README.md'];
    const entries = buildEntries(paths, '/root', 100);

    const dirs = entries.filter((e) => e.type === 'directory');
    const files = entries.filter((e) => e.type === 'file');

    expect(dirs).toHaveLength(2);
    expect(dirs.map((d) => d.path).sort()).toEqual(['src', 'src/utils']);
    expect(files).toHaveLength(3);
  });

  it('caps entries at maxEntries', () => {
    const paths = Array.from({ length: 100 }, (_, i) => `file${i}.ts`);
    const entries = buildEntries(paths, '/root', 50);
    expect(entries).toHaveLength(50);
  });

  it('returns empty array for empty input', () => {
    const entries = buildEntries([], '/root', 100);
    expect(entries).toHaveLength(0);
  });

  it('sorts entries alphabetically', () => {
    const paths = ['z.ts', 'a.ts', 'm/b.ts'];
    const entries = buildEntries(paths, '/root', 100);
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
  });

  it('returns file tree with entries from git ls-files', async () => {
    // First call: tracked files, second call: untracked files
    mockSuccess('src/index.ts\nREADME.md\n');
    mockSuccess('draft.txt\n');

    const tree = await scanFileTree('/test/repo');

    expect(tree.rootDir).toBe('/test/repo');
    expect(tree.scannedAt).toBeGreaterThan(0);

    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);
    expect(filePaths).toContain('src/index.ts');
    expect(filePaths).toContain('README.md');
    expect(filePaths).toContain('draft.txt');
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

  it('returns empty tree when git fails', async () => {
    mockFailure('not a git repo');

    const tree = await scanFileTree('/not/a/repo');
    expect(tree.entries).toHaveLength(0);
  });
});
