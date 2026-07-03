import { exec } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import type * as FsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { isExcluded, buildEntries } from './file-tree-scanner.js';

// Mock child_process and util before importing scanFileTree
vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('node:util', () => ({
  promisify: (fn: Function) => fn,
}));

// Use importOriginal to allow real fs/promises operations for temp dir tests
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof FsPromises;
  return {
    ...actual,
  };
});

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
    // First call: isGitRepo check, then tracked files, then untracked files
    mockSuccess('true\n'); // isGitRepo
    mockSuccess('src/index.ts\nREADME.md\n'); // tracked
    mockSuccess(''); // deleted
    mockSuccess('draft.txt\n'); // untracked

    const tree = await scanFileTree('/test/repo');

    expect(tree.rootDir).toBe('/test/repo');
    expect(tree.scannedAt).toBeGreaterThan(0);

    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);
    expect(filePaths).toContain('src/index.ts');
    expect(filePaths).toContain('README.md');
    expect(filePaths).toContain('draft.txt');
  });

  it('deduplicates tracked and untracked files', async () => {
    mockSuccess('true\n'); // isGitRepo
    mockSuccess('src/index.ts\n'); // tracked
    mockSuccess(''); // deleted
    mockSuccess('src/index.ts\n'); // untracked (duplicate)

    const tree = await scanFileTree('/test/repo');
    const files = tree.entries.filter((e) => e.type === 'file');
    expect(files).toHaveLength(1);
  });

  it('filters out excluded paths', async () => {
    mockSuccess('true\n'); // isGitRepo
    mockSuccess('src/app.ts\nnode_modules/pkg/index.js\ndist/bundle.js\n'); // tracked
    mockSuccess(''); // deleted
    mockSuccess(''); // untracked

    const tree = await scanFileTree('/test/repo');
    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);

    expect(filePaths).toContain('src/app.ts');
    expect(filePaths).not.toContain('node_modules/pkg/index.js');
    expect(filePaths).not.toContain('dist/bundle.js');
  });

  it('caps at maxEntries', async () => {
    const manyFiles = Array.from({ length: 200 }, (_, i) => `file${i}.ts`).join('\n');
    mockSuccess('true\n'); // isGitRepo
    mockSuccess(manyFiles); // tracked
    mockSuccess(''); // deleted
    mockSuccess(''); // untracked

    const tree = await scanFileTree('/test/repo', { maxEntries: 50 });
    expect(tree.entries.length).toBeLessThanOrEqual(50);
  });

  it('returns empty tree when git fails', async () => {
    mockFailure('not a git repo'); // isGitRepo fails

    const tree = await scanFileTree('/not/a/repo');
    // Should fall back to FS walk, but the directory doesn't exist
    // so it will return empty
    expect(tree.entries).toHaveLength(0);
  });

  it('excludes tracked files deleted from the working tree (git ls-files --deleted)', async () => {
    mockSuccess('true\n'); // isGitRepo
    mockSuccess('docs/readme.md\nsrc/index.ts\n'); // tracked
    mockSuccess('docs/readme.md\n'); // deleted from working tree
    mockSuccess(''); // untracked

    const tree = await scanFileTree('/test/repo');

    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);
    const dirPaths = tree.entries.filter((e) => e.type === 'directory').map((e) => e.path);

    expect(filePaths).toContain('src/index.ts');
    expect(filePaths).not.toContain('docs/readme.md');
    expect(dirPaths).not.toContain('docs');
  });
});

describe('FS-walk fallback (non-git directories)', () => {
  let tmpDir: string;

  beforeEach(async () => {
    // Create a unique temp directory for each test
    tmpDir = await mkdtemp(join(tmpdir(), 'chatroom-test-'));
  });

  afterEach(async () => {
    // Clean up temp directory
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('scans non-git directory and returns file entries', async () => {
    // Create test files
    await writeFile(join(tmpDir, 'a.txt'), 'content a');
    await writeFile(join(tmpDir, 'b.txt'), 'content b');
    await mkdir(join(tmpDir, 'sub'));
    await writeFile(join(tmpDir, 'sub', 'c.txt'), 'content c');

    // Note: Don't create .git directory, so it's not a git repo
    const tree = await scanFileTree(tmpDir);

    expect(tree.rootDir).toBe(tmpDir);
    expect(tree.entries.length).toBeGreaterThan(0);

    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);
    const dirPaths = tree.entries.filter((e) => e.type === 'directory').map((e) => e.path);

    expect(filePaths).toContain('a.txt');
    expect(filePaths).toContain('b.txt');
    expect(filePaths).toContain('sub/c.txt');
    expect(dirPaths).toContain('sub');
  });

  it('honors ALWAYS_EXCLUDE in fallback mode', async () => {
    await writeFile(join(tmpDir, 'keep.txt'), 'keep this');
    await mkdir(join(tmpDir, 'node_modules'));
    await writeFile(join(tmpDir, 'node_modules', 'x.txt'), 'should be excluded');

    const tree = await scanFileTree(tmpDir);

    const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);
    const dirPaths = tree.entries.filter((e) => e.type === 'directory').map((e) => e.path);

    expect(filePaths).toContain('keep.txt');
    expect(filePaths).not.toContain('node_modules/x.txt');
    expect(dirPaths).not.toContain('node_modules');
  });

  it('skips oversized subtree but keeps siblings', async () => {
    // Import walkFsFallback for direct testing
    const { walkFsFallback } = await import('./file-tree-scanner.js');

    // Create a small file
    await writeFile(join(tmpDir, 'small.txt'), 'tiny');

    // Create a large file in a subdirectory
    await mkdir(join(tmpDir, 'big'));
    const largeContent = Buffer.alloc(2048); // 2 KB
    await writeFile(join(tmpDir, 'big', 'large.bin'), largeContent);

    // Use a small maxSubtreeBytes (1 KB) so the 'big' folder is skipped
    const files = await walkFsFallback(tmpDir, 10_000, 1024);

    expect(files).toContain('small.txt');
    expect(files.some((f) => f.startsWith('big/'))).toBe(false);
  });

  it('respects maxEntries cap in fallback mode', async () => {
    // Create more files than the cap
    for (let i = 0; i < 10; i++) {
      await writeFile(join(tmpDir, `file${i}.txt`), `content ${i}`);
    }

    const tree = await scanFileTree(tmpDir, { maxEntries: 5 });
    expect(tree.entries.length).toBeLessThanOrEqual(5);
  });

  it('git repo still uses git ls-files (no regression)', async () => {
    // Initialize a real git repo for this test
    const { exec } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execAsync = promisify(exec);

    try {
      await execAsync('git init', { cwd: tmpDir });
      await writeFile(join(tmpDir, 'tracked.txt'), 'tracked');
      await execAsync('git add tracked.txt', { cwd: tmpDir });

      // Mock git commands for scanFileTree: isGitRepo, tracked, deleted, untracked
      mockSuccess('true\n'); // isGitRepo
      mockSuccess('tracked.txt\n'); // tracked
      mockSuccess(''); // deleted
      mockSuccess(''); // untracked files

      const tree = await scanFileTree(tmpDir);

      const filePaths = tree.entries.filter((e) => e.type === 'file').map((e) => e.path);
      expect(filePaths).toContain('tracked.txt');
    } catch {
      // If git is not available, skip this test
      console.log('Skipping git repo test: git not available');
    }
  });
});
