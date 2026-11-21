import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SCAN_DEFAULTS, SKIP_DIR_NAMES, scanRepositories } from './scan-repositories.js';

let workDir: string;

beforeEach(() => {
  workDir = mkdtempSync(join(tmpdir(), 'scan-repositories-test-'));
});

afterEach(() => {
  rmSync(workDir, { recursive: true, force: true });
});

/**
 * Creates a directory that looks like a repository to the scanner: a `.git`
 * directory with a hand-written `HEAD` (and optional `config`). No git is run.
 */
function makeRepo(dir: string, options: { head?: string | null; config?: string } = {}): string {
  mkdirSync(join(dir, '.git'), { recursive: true });
  const head = options.head === undefined ? 'ref: refs/heads/main\n' : options.head;
  if (head !== null) writeFileSync(join(dir, '.git', 'HEAD'), head);
  if (options.config !== undefined) writeFileSync(join(dir, '.git', 'config'), options.config);
  return dir;
}

function makeDirs(root: string, names: string[]): void {
  for (const name of names) mkdirSync(join(root, name), { recursive: true });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

describe('scanRepositories discovery', () => {
  it('finds repositories under a root and reports path, name, root, branch and remote', async () => {
    const root = join(workDir, 'projects');
    const alpha = makeRepo(join(root, 'alpha'), {
      config: '[remote "origin"]\n\turl = https://github.com/acme/alpha.git\n',
    });
    const beta = makeRepo(join(root, 'nested', 'beta'));

    const result = await scanRepositories({ roots: [`${root}/`] });

    expect(result.truncated).toBe(false);
    expect(result.roots).toEqual([{ path: root, status: 'ok', repositoryCount: 2 }]);
    expect(result.repositories).toEqual([
      {
        path: alpha,
        name: 'alpha',
        root,
        branch: 'main',
        remoteUrl: 'https://github.com/acme/alpha.git',
      },
      { path: beta, name: 'beta', root, branch: 'main', remoteUrl: null },
    ]);
  });

  it('lists a root that is itself a repository (depth 0) and does not descend into it', async () => {
    const root = makeRepo(join(workDir, 'solo'));
    makeRepo(join(root, 'nested'));
    makeRepo(join(root, 'a', 'b', 'nested-deep'));

    const result = await scanRepositories({ roots: [root] });

    expect(result.truncated).toBe(false);
    expect(result.roots).toEqual([{ path: root, status: 'ok', repositoryCount: 1 }]);
    expect(result.repositories).toHaveLength(1);
    expect(result.repositories[0]).toEqual({
      path: root,
      name: basename(root),
      root,
      branch: 'main',
      remoteUrl: null,
    });
  });

  it('does not descend below a found repository', async () => {
    const root = join(workDir, 'ledger');
    const outer = makeRepo(join(root, 'a'));
    makeRepo(join(root, 'a', 'sub'));

    const result = await scanRepositories({ roots: [root] });

    expect(result.repositories.map((repo) => repo.path)).toEqual([outer]);
    expect(result.roots).toEqual([{ path: root, status: 'ok', repositoryCount: 1 }]);
  });

  it('does not list a directory whose .git is a file', async () => {
    const root = join(workDir, 'worktrees');
    const worktree = join(root, 'linked-worktree');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, '.git'), 'gitdir: ../x\n');
    const real = makeRepo(join(root, 'real'));

    const result = await scanRepositories({ roots: [root] });

    expect(result.repositories.map((repo) => repo.path)).toEqual([real]);
    expect(result.truncated).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

describe('scanRepositories bounds', () => {
  it('finds a repository at the depth cap and hides one beyond it (truncated)', async () => {
    const root = join(workDir, 'deep');
    const atDepthTwo = makeRepo(join(root, 'a', 'repo-two'));
    makeRepo(join(root, 'a', 'b', 'repo-three'));

    const result = await scanRepositories({ roots: [root], maxDepth: 2 });

    expect(result.repositories.map((repo) => repo.path)).toEqual([atDepthTwo]);
    expect(result.truncated).toBe(true);
  });

  it('skips dot-directories and heavy/cache directory names', async () => {
    const root = join(workDir, 'skip');
    makeRepo(join(root, 'node_modules', 'dep-repo'));
    makeRepo(join(root, 'vendor', 'vendor-repo'));
    makeRepo(join(root, 'Library', 'library-repo'));
    makeRepo(join(root, '.hidden', 'hidden-repo'));
    makeRepo(join(root, '.Trash', 'trash-repo'));
    makeRepo(join(root, 'target', 'target-repo'));
    makeRepo(join(root, 'venv', 'venv-repo'));
    makeRepo(join(root, 'Pods', 'pods-repo'));
    makeRepo(join(root, 'bower_components', 'bower-repo'));
    const normal = makeRepo(join(root, 'src', 'normal-repo'));

    const result = await scanRepositories({ roots: [root] });

    expect(result.repositories.map((repo) => repo.path)).toEqual([normal]);
  });

  it('never follows symlinks and terminates on a self-referential symlink', async () => {
    const root = join(workDir, 'links');
    mkdirSync(join(root, 'a'), { recursive: true });
    symlinkSync('..', join(root, 'a', 'link'));
    const real = makeRepo(join(root, 'a', 'real-repo'));

    const external = makeRepo(join(workDir, 'external-repo'));
    symlinkSync(external, join(root, 'linked'));

    const result = await scanRepositories({ roots: [root] });

    expect(result.repositories.map((repo) => repo.path)).toEqual([real]);
    expect(result.repositories.map((repo) => repo.path)).not.toContain(external);
  });

  it('stops at the directory cap and reports truncation', async () => {
    const root = join(workDir, 'wide');
    makeDirs(root, ['d1', 'd2', 'd3', 'd4', 'd5', 'd6']);

    const result = await scanRepositories({ roots: [root], maxDirectories: 3 });

    expect(result.truncated).toBe(true);
    expect(result.roots).toEqual([{ path: root, status: 'ok', repositoryCount: 0 }]);
  });

  it('stops at the repository cap and reports truncation', async () => {
    const root = join(workDir, 'many');
    makeRepo(join(root, 'r1'));
    makeRepo(join(root, 'r2'));
    makeRepo(join(root, 'r3'));

    const result = await scanRepositories({ roots: [root], maxRepositories: 2 });

    expect(result.repositories.map((repo) => repo.name)).toEqual(['r1', 'r2']);
    expect(result.truncated).toBe(true);
    expect(result.roots).toEqual([{ path: root, status: 'ok', repositoryCount: 2 }]);
  });

  it('stops when the time budget is exhausted (injected clock)', async () => {
    const root = join(workDir, 'slow');
    for (let index = 0; index < 8; index += 1) {
      makeRepo(join(root, `d${index}`, 'repo'));
    }

    let clock = 0;
    const result = await scanRepositories({
      roots: [root],
      timeBudgetMs: 250,
      now: () => {
        const value = clock;
        clock += 100;
        return value;
      },
    });

    expect(result.truncated).toBe(true);
    expect(result.repositories.length).toBeLessThan(8);
  });
});

// ---------------------------------------------------------------------------
// Root statuses
// ---------------------------------------------------------------------------

describe('scanRepositories root statuses', () => {
  it('reports a missing root', async () => {
    const missing = join(workDir, 'does-not-exist');

    const result = await scanRepositories({ roots: [missing] });

    expect(result.repositories).toEqual([]);
    expect(result.roots).toEqual([{ path: missing, status: 'missing', repositoryCount: 0 }]);
    expect(result.truncated).toBe(false);
  });

  it('reports a plain file root as missing', async () => {
    const file = join(workDir, 'a-file');
    writeFileSync(file, 'not a directory');

    const result = await scanRepositories({ roots: [file] });

    expect(result.roots).toEqual([{ path: file, status: 'missing', repositoryCount: 0 }]);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports an unreadable root',
    async () => {
      const root = join(workDir, 'locked');
      mkdirSync(root);
      makeRepo(join(root, 'repo'));
      chmodSync(root, 0o000);
      try {
        const result = await scanRepositories({ roots: [root] });

        expect(result.repositories).toEqual([]);
        expect(result.roots).toEqual([{ path: root, status: 'unreadable', repositoryCount: 0 }]);
      } finally {
        chmodSync(root, 0o755);
      }
    }
  );

  it('keeps per-root statuses and counts independent across multiple roots', async () => {
    const okRoot = join(workDir, 'ok-root');
    const found = makeRepo(join(okRoot, 'repo'));
    const missingRoot = join(workDir, 'missing-root');

    const result = await scanRepositories({ roots: [missingRoot, okRoot, missingRoot] });

    expect(result.roots).toEqual([
      { path: missingRoot, status: 'missing', repositoryCount: 0 },
      { path: okRoot, status: 'ok', repositoryCount: 1 },
    ]);
    expect(result.repositories.map((repo) => repo.path)).toEqual([found]);
  });
});

// ---------------------------------------------------------------------------
// Branch and remote parsing
// ---------------------------------------------------------------------------

describe('scanRepositories branch parsing', () => {
  it('parses branch names, detached HEADs and missing HEAD files', async () => {
    const root = join(workDir, 'branches');
    makeRepo(join(root, 'feature'), { head: 'ref: refs/heads/feat/x\n' });
    makeRepo(join(root, 'detached'), { head: `${'a'.repeat(40)}\n` });
    makeRepo(join(root, 'no-head'), { head: null });

    const result = await scanRepositories({ roots: [root] });

    expect(result.repositories.map((repo) => ({ name: repo.name, branch: repo.branch }))).toEqual([
      { name: 'detached', branch: null },
      { name: 'feature', branch: 'feat/x' },
      { name: 'no-head', branch: null },
    ]);
  });
});

describe('scanRepositories remote parsing', () => {
  it('prefers origin even when another remote is listed first', async () => {
    const root = join(workDir, 'remotes');
    makeRepo(join(root, 'prefers-origin'), {
      config: [
        '[remote "upstream"]',
        '\turl = https://github.com/upstream/repo.git',
        '[remote "origin"]',
        '\turl = https://github.com/origin/repo.git',
        '',
      ].join('\n'),
    });
    makeRepo(join(root, 'first-remote'), {
      config: [
        '[remote "fork"]',
        '\turl = https://github.com/fork/repo.git',
        '[remote "mirror"]',
        '\turl = https://github.com/mirror/repo.git',
        '',
      ].join('\n'),
    });
    makeRepo(join(root, 'no-remote'), {
      config: ['[core]', '\tbare = false', ''].join('\n'),
    });

    const result = await scanRepositories({ roots: [root] });

    expect(
      result.repositories.map((repo) => ({ name: repo.name, remoteUrl: repo.remoteUrl }))
    ).toEqual([
      { name: 'first-remote', remoteUrl: 'https://github.com/fork/repo.git' },
      { name: 'no-remote', remoteUrl: null },
      { name: 'prefers-origin', remoteUrl: 'https://github.com/origin/repo.git' },
    ]);
  });

  it('redacts credentials from URL-style remotes and leaves scp-style remotes untouched', async () => {
    const root = join(workDir, 'redaction');
    const cases: [string, string][] = [
      ['user-and-token', 'https://user:tok@github.com/x/y.git'],
      ['token-only', 'https://tok@github.com/x/y.git'],
      ['scp-style', 'git@github.com:org/repo.git'],
      ['ssh-url', 'ssh://git@host/org/repo.git'],
    ];
    for (const [name, url] of cases) {
      makeRepo(join(root, name), {
        config: ['[remote "origin"]', `\turl = ${url}`, ''].join('\n'),
      });
    }

    const result = await scanRepositories({ roots: [root] });

    expect(
      result.repositories.map((repo) => ({ name: repo.name, remoteUrl: repo.remoteUrl }))
    ).toEqual([
      { name: 'scp-style', remoteUrl: 'git@github.com:org/repo.git' },
      { name: 'ssh-url', remoteUrl: 'ssh://host/org/repo.git' },
      { name: 'token-only', remoteUrl: 'https://github.com/x/y.git' },
      { name: 'user-and-token', remoteUrl: 'https://github.com/x/y.git' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Cooperativeness and constants
// ---------------------------------------------------------------------------

describe('scanRepositories cooperativeness', () => {
  it('yields to the event loop so timers run during a scan', async () => {
    const root = join(workDir, 'cooperative');
    for (let index = 0; index < 30; index += 1) {
      mkdirSync(join(root, `dir-${index}`), { recursive: true });
    }

    let ticks = 0;
    const interval = setInterval(() => {
      ticks += 1;
    }, 0);

    try {
      await scanRepositories({ roots: [root], yieldEvery: 5 });
    } finally {
      clearInterval(interval);
    }

    expect(ticks).toBeGreaterThanOrEqual(1);
  });
});

describe('scan constants', () => {
  it('exposes the documented defaults', () => {
    expect(SCAN_DEFAULTS).toEqual({
      maxDepth: 6,
      maxDirectories: 20_000,
      maxRepositories: 1000,
      timeBudgetMs: 60_000,
      yieldEvery: 200,
    });
  });

  it('skips dot-directories and the documented heavy directory names', () => {
    for (const name of [
      'node_modules',
      'Library',
      'target',
      'vendor',
      'venv',
      'Pods',
      'bower_components',
      '.Trash',
    ]) {
      expect(SKIP_DIR_NAMES.has(name)).toBe(true);
    }
  });
});
