/**
 * workspace-git-probe Unit Tests
 *
 * Covers single-flight reads, cache age, read errors, edit fingerprints, the pure diff rules,
 * and the root pathspec projection. Stat-based cases use a real temp directory.
 */
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  createWorkspaceGitProbe,
  diffProbeSnapshots,
  readGitRenameLimit,
  renameLimitFromConfig,
  toRootChangeSourceSnapshot,
  type ProbeSnapshot,
} from './workspace-git-probe.js';
import type { GitRepoNode } from '../../../../infrastructure/services/workspace/git-workspace-hierarchy.js';
import {
  readGitHead,
  readGitPorcelainStatus,
  type GitBranchHeader,
  type GitPorcelainEntry,
} from '../../../../infrastructure/services/workspace/git-workspace-porcelain.js';
import { LOCAL_KINDS } from '../domain/workspace-state-unit.js';

const BRANCH: GitBranchHeader = {
  oid: 'aaa111',
  head: 'main',
  upstream: 'origin/main',
  ahead: 0,
  behind: 0,
};

function status(entries: GitPorcelainEntry[] = [], branch: Partial<GitBranchHeader> = {}) {
  return { branch: { ...BRANCH, ...branch }, entries };
}

function snapshot(overrides: Partial<ProbeSnapshot> = {}): ProbeSnapshot {
  return {
    branch: BRANCH,
    entries: [],
    dirtyStats: new Map(),
    statCapped: false,
    readAt: 0,
    ...overrides,
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-git-probe-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('createWorkspaceGitProbe: single-flight and cache', () => {
  test('two concurrent readSnapshot calls trigger exactly one readStatus call', async () => {
    const readStatus = vi.fn(async () => status());
    const probe = createWorkspaceGitProbe({
      workTree: tmpDir,
      rootPathspec: [],
      dirtyStatCap: 10,
      now: () => 0,
      readStatus,
    });

    const [a, b] = await Promise.all([
      probe.readSnapshot({ maxAgeMs: 0 }),
      probe.readSnapshot({ maxAgeMs: 0 }),
    ]);

    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  test('a concurrent caller shares the in-flight read even with a generous maxAgeMs', async () => {
    let release: (() => void) | undefined;
    const readStatus = vi.fn(
      () =>
        new Promise<ReturnType<typeof status>>((resolve) => {
          release = () => resolve(status());
        })
    );
    const probe = createWorkspaceGitProbe({
      workTree: tmpDir,
      rootPathspec: [],
      dirtyStatCap: 10,
      now: () => 0,
      readStatus,
    });

    const first = probe.readSnapshot({ maxAgeMs: 0 });
    const second = probe.readSnapshot({ maxAgeMs: 999_999 });
    release?.();
    const [a, b] = await Promise.all([first, second]);

    expect(readStatus).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
  });

  test('cached snapshot is reused within maxAgeMs and re-read after it', async () => {
    let clock = 1000;
    const readStatus = vi.fn(async () => status());
    const probe = createWorkspaceGitProbe({
      workTree: tmpDir,
      rootPathspec: [],
      dirtyStatCap: 10,
      now: () => clock,
      readStatus,
    });

    await probe.readSnapshot({ maxAgeMs: 1000 });
    clock += 500;
    await probe.readSnapshot({ maxAgeMs: 1000 });
    expect(readStatus).toHaveBeenCalledTimes(1);

    clock += 1001;
    await probe.readSnapshot({ maxAgeMs: 1000 });
    expect(readStatus).toHaveBeenCalledTimes(2);
  });

  test('a rejected read rejects the caller and the next call retries', async () => {
    const readStatus = vi
      .fn<() => Promise<ReturnType<typeof status>>>()
      .mockRejectedValueOnce(new Error('git exploded'))
      .mockResolvedValueOnce(status([{ xy: ' M', path: 'a.ts' }]));
    const probe = createWorkspaceGitProbe({
      workTree: tmpDir,
      rootPathspec: [],
      dirtyStatCap: 10,
      now: () => 0,
      readStatus,
    });

    await expect(probe.readSnapshot({ maxAgeMs: 0 })).rejects.toThrow('git exploded');
    const retried = await probe.readSnapshot({ maxAgeMs: 0 });

    expect(readStatus).toHaveBeenCalledTimes(2);
    expect(retried.entries).toEqual([{ xy: ' M', path: 'a.ts' }]);
  });

  test('a failed re-read does not return the previously cached snapshot', async () => {
    let clock = 0;
    const readStatus = vi
      .fn<() => Promise<ReturnType<typeof status>>>()
      .mockResolvedValueOnce(status())
      .mockRejectedValueOnce(new Error('git exploded'));
    const probe = createWorkspaceGitProbe({
      workTree: tmpDir,
      rootPathspec: [],
      dirtyStatCap: 10,
      now: () => clock,
      readStatus,
    });

    await probe.readSnapshot({ maxAgeMs: 0 });
    clock = 5000;
    await expect(probe.readSnapshot({ maxAgeMs: 1000 })).rejects.toThrow('git exploded');
  });
});

describe('createWorkspaceGitProbe: edit fingerprints', () => {
  test('editing a file changes its dirtyStats value', async () => {
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'abc');
    let clock = 0;
    const probe = createWorkspaceGitProbe({
      workTree: tmpDir,
      rootPathspec: [],
      dirtyStatCap: 10,
      now: () => clock,
      readStatus: async () => status([{ xy: ' M', path: 'a.txt' }]),
    });

    const before = (await probe.readSnapshot({ maxAgeMs: 0 })).dirtyStats.get('a.txt');

    await fs.writeFile(file, 'abcdef');
    clock += 1;
    const after = (await probe.readSnapshot({ maxAgeMs: 0 })).dirtyStats.get('a.txt');

    expect(before).toMatch(/^\d+(\.\d+)?:3$/);
    expect(after).toMatch(/^\d+(\.\d+)?:6$/);
    expect(after).not.toBe(before);
  });

  test('a deleted file is recorded as missing', async () => {
    const probe = createWorkspaceGitProbe({
      workTree: tmpDir,
      rootPathspec: [],
      dirtyStatCap: 10,
      now: () => 0,
      readStatus: async () => status([{ xy: ' D', path: 'gone.txt' }]),
    });

    const snap = await probe.readSnapshot({ maxAgeMs: 0 });

    expect(snap.dirtyStats.get('gone.txt')).toBe('missing');
  });

  test('statCapped is true and stats are limited when entries exceed dirtyStatCap', async () => {
    const entries = ['1.txt', '2.txt', '3.txt'].map((p) => ({ xy: ' M', path: p }));
    const probe = createWorkspaceGitProbe({
      workTree: tmpDir,
      rootPathspec: [],
      dirtyStatCap: 2,
      now: () => 0,
      readStatus: async () => status(entries),
    });

    const snap = await probe.readSnapshot({ maxAgeMs: 0 });

    expect(snap.statCapped).toBe(true);
    expect(snap.dirtyStats.size).toBe(2);
    expect(snap.dirtyStats.has('3.txt')).toBe(false);
    expect(snap.entries).toHaveLength(3);
  });

  test('statCapped is false when entries fit within dirtyStatCap', async () => {
    const probe = createWorkspaceGitProbe({
      workTree: tmpDir,
      rootPathspec: [],
      dirtyStatCap: 2,
      now: () => 0,
      readStatus: async () => status([{ xy: ' M', path: 'x.txt' }]),
    });

    const snap = await probe.readSnapshot({ maxAgeMs: 0 });

    expect(snap.statCapped).toBe(false);
  });
});

describe('diffProbeSnapshots', () => {
  test('prev null → all LOCAL_KINDS and remoteTrigger', () => {
    const result = diffProbeSnapshots(null, snapshot());
    expect(result.localKinds).toEqual(new Set(LOCAL_KINDS));
    expect(result.remoteTrigger).toBe(true);
  });

  test('branch switch to a commit with the same oid → all LOCAL_KINDS and remoteTrigger', () => {
    const prev = snapshot({ branch: { ...BRANCH, head: 'main' } });
    const next = snapshot({ branch: { ...BRANCH, head: 'feature' } });
    const result = diffProbeSnapshots(prev, next);
    expect(result.localKinds).toEqual(new Set(LOCAL_KINDS));
    expect(result.remoteTrigger).toBe(true);
  });

  test('oid change → all LOCAL_KINDS and remoteTrigger', () => {
    const prev = snapshot();
    const next = snapshot({ branch: { ...BRANCH, oid: 'bbb222' } });
    const result = diffProbeSnapshots(prev, next);
    expect(result.localKinds).toEqual(new Set(LOCAL_KINDS));
    expect(result.remoteTrigger).toBe(true);
  });

  test('ahead/behind change only → {upstream} and remoteTrigger', () => {
    const prev = snapshot({ branch: { ...BRANCH, ahead: 0 } });
    const next = snapshot({ branch: { ...BRANCH, ahead: 2 } });
    const result = diffProbeSnapshots(prev, next);
    expect(result.localKinds).toEqual(new Set(['upstream']));
    expect(result.remoteTrigger).toBe(true);
  });

  test('edit to an already-modified file (same entries, changed stat) → {worktree}, no remoteTrigger', () => {
    const entries = [{ xy: ' M', path: 'src/a.ts' }];
    const prev = snapshot({ entries, dirtyStats: new Map([['src/a.ts', '100:3']]) });
    const next = snapshot({ entries, dirtyStats: new Map([['src/a.ts', '200:4']]) });
    const result = diffProbeSnapshots(prev, next);
    expect(result.localKinds).toEqual(new Set(['worktree']));
    expect(result.remoteTrigger).toBe(false);
  });

  test('changed package.json → {worktree, commands}', () => {
    const prev = snapshot();
    const next = snapshot({ entries: [{ xy: ' M', path: 'packages/cli/package.json' }] });
    const result = diffProbeSnapshots(prev, next);
    expect(result.localKinds).toEqual(new Set(['worktree', 'commands']));
    expect(result.remoteTrigger).toBe(false);
  });

  test('changed src/a.ts → {worktree} only', () => {
    const prev = snapshot();
    const next = snapshot({ entries: [{ xy: ' M', path: 'src/a.ts' }] });
    const result = diffProbeSnapshots(prev, next);
    expect(result.localKinds).toEqual(new Set(['worktree']));
    expect(result.remoteTrigger).toBe(false);
  });

  test('no change → empty set and no remoteTrigger', () => {
    const entries = [{ xy: ' M', path: 'src/a.ts' }];
    const dirtyStats = new Map([['src/a.ts', '100:3']]);
    const result = diffProbeSnapshots(
      snapshot({ entries, dirtyStats }),
      snapshot({ entries, dirtyStats })
    );
    expect(result.localKinds).toEqual(new Set());
    expect(result.remoteTrigger).toBe(false);
  });
});

/** Default git rename limit; the pure projection tests pass it explicitly. */
const DEFAULT_RENAME_LIMIT = 1000;

describe('toRootChangeSourceSnapshot', () => {
  const inside = snapshot({
    entries: [
      { xy: ' M', path: 'packages/cli/x.ts' },
      { xy: ' M', path: 'apps/web/y.ts' },
      { xy: ' M', path: 'packages/cli-old/z.ts' },
    ],
  });

  function project(s: ProbeSnapshot, pathspec: string[], renameLimit = DEFAULT_RENAME_LIMIT) {
    const root = toRootChangeSourceSnapshot(s, pathspec, renameLimit);
    if (root === undefined) throw new Error('expected a projected root snapshot');
    return root;
  }

  test('keeps entries under the prefix and drops others', () => {
    const paths = project(inside, ['packages/cli']).entries.map((e) => e.path);
    expect(paths).toContain('packages/cli/x.ts');
    expect(paths).not.toContain('apps/web/y.ts');
  });

  test('a prefix does not match a sibling directory that shares its leading characters', () => {
    const paths = project(inside, ['packages/cli']).entries.map((e) => e.path);
    expect(paths).not.toContain('packages/cli-old/z.ts');
  });

  test('a trailing slash on the prefix is ignored', () => {
    const paths = project(inside, ['packages/cli/']).entries.map((e) => e.path);
    expect(paths).toContain('packages/cli/x.ts');
  });

  test('empty pathspec keeps everything', () => {
    expect(project(inside, []).entries).toHaveLength(inside.entries.length);
  });

  test('head is the branch oid', () => {
    expect(project(inside, []).head).toEqual({ head: 'aaa111' });
  });

  test.each(['apps/[slug]', 'apps/*', 'apps/?', 'apps/a]b', 'apps\\x'])(
    'returns undefined when the pathspec %s contains a glob metacharacter',
    (pathspec) => {
      expect(toRootChangeSourceSnapshot(inside, [pathspec], DEFAULT_RENAME_LIMIT)).toBeUndefined();
    }
  );

  test('returns undefined when a rename sits entirely outside the pathspec', () => {
    const s = snapshot({
      entries: [
        { xy: ' M', path: 'packages/cli/x.ts' },
        { xy: 'R ', path: 'apps/web/moved.ts', fromPath: 'apps/web/old.ts' },
      ],
    });
    expect(toRootChangeSourceSnapshot(s, ['packages/cli'], DEFAULT_RENAME_LIMIT)).toBeUndefined();
  });

  test('returns undefined when a copy is present', () => {
    const s = snapshot({
      entries: [{ xy: 'C ', path: 'packages/cli/copy.ts', fromPath: 'packages/cli/x.ts' }],
    });
    expect(toRootChangeSourceSnapshot(s, ['packages/cli'], DEFAULT_RENAME_LIMIT)).toBeUndefined();
  });

  test('returns undefined when adds × deletes exceeds the limit squared', () => {
    // 3 adds (A, A, ??) and 2 deletes (D, worktree D): product 6.
    const s = snapshot({
      entries: [
        { xy: 'A ', path: 'packages/cli/a1.ts' },
        { xy: '??', path: 'packages/cli/a2.ts' },
        { xy: 'A ', path: 'apps/web/a3.ts' },
        { xy: 'D ', path: 'packages/cli/d1.ts' },
        { xy: ' D', path: 'apps/web/d2.ts' },
      ],
    });
    expect(toRootChangeSourceSnapshot(s, ['packages/cli'], 2)).toBeUndefined(); // 6 > 4
    expect(toRootChangeSourceSnapshot(s, ['packages/cli'], 3)).toBeDefined(); // 6 <= 9
  });

  test('a product equal to the limit squared is accepted', () => {
    const s = snapshot({
      entries: [
        { xy: 'A ', path: 'packages/cli/a1.ts' },
        { xy: '??', path: 'packages/cli/a2.ts' },
        { xy: 'D ', path: 'packages/cli/d1.ts' },
        { xy: ' D', path: 'packages/cli/d2.ts' },
      ],
    });
    expect(toRootChangeSourceSnapshot(s, ['packages/cli'], 2)).toBeDefined(); // 4 <= 4
  });
});

describe('renameLimitFromConfig', () => {
  test.each([
    ['unset', '', 1000],
    ['diff.renamelimit only', 'diff.renamelimit 2\n', 2],
    [
      'status.renamelimit overrides diff.renamelimit',
      'diff.renamelimit 2\nstatus.renamelimit 5\n',
      5,
    ],
    ['zero (unlimited in git) is treated as 1', 'diff.renamelimit 0\n', 1],
    ['negative is treated as 1', 'diff.renamelimit -1\n', 1],
    ['a suffixed value git would accept is treated as 1', 'diff.renamelimit 2k\n', 1],
    ['a key without a value is treated as 1', 'diff.renamelimit\n', 1],
  ])('%s', (_label, stdout, expected) => {
    expect(renameLimitFromConfig(stdout)).toBe(expected);
  });
});

describe('toRootChangeSourceSnapshot against the v1 root reader (git fixtures)', () => {
  // Non-ASCII names: git orders them by UTF-8 bytes, which differs from UTF-16 code units.
  const FULLWIDTH_TILDE = '～.ts';
  const EMOJI = '\u{1F600}.ts';

  let repoRoot: string;

  type RootView = {
    head: { head: string | null };
    entries: { xy: string; path: string; fromPath: string | undefined }[];
  };

  function git(args: string[]): void {
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd: repoRoot, stdio: 'pipe' });
  }

  async function write(relPath: string, content: string): Promise<void> {
    const abs = path.join(repoRoot, relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content);
  }

  async function initRepo(dir: string): Promise<void> {
    repoRoot = dir;
    await fs.mkdir(repoRoot);
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'parity@example.com']);
    git(['config', 'user.name', 'Parity']);
  }

  /** The v1 root reader for a root node whose pathspec is `pathspec`. */
  async function readV1Root(pathspec: string[]): Promise<RootView> {
    const node: GitRepoNode = {
      workTree: repoRoot,
      gitDir: path.join(repoRoot, '.git'),
      relativePath: '',
      pathspec,
      children: [],
    };
    const [head, entries] = await Promise.all([
      readGitHead(repoRoot),
      readGitPorcelainStatus(node),
    ]);
    return {
      head,
      entries: entries.map(({ xy, path: p, fromPath }) => ({ xy, path: p, fromPath })),
    };
  }

  /** The projected root for `pathspec`, or undefined when the projection declines. */
  async function readProbeRootOrUndefined(pathspec: string[]): Promise<RootView | undefined> {
    const snapshot = await createWorkspaceGitProbe({
      workTree: repoRoot,
      rootPathspec: pathspec,
      dirtyStatCap: 500,
    }).readSnapshot({ maxAgeMs: 0 });
    const root = toRootChangeSourceSnapshot(snapshot, pathspec, await readGitRenameLimit(repoRoot));
    if (root === undefined) return undefined;
    return {
      head: root.head,
      entries: root.entries.map(({ xy, path: p, fromPath }) => ({ xy, path: p, fromPath })),
    };
  }

  async function readProbeRoot(pathspec: string[]): Promise<RootView> {
    const root = await readProbeRootOrUndefined(pathspec);
    if (root === undefined) throw new Error('expected a projected root snapshot');
    return root;
  }

  const sharedLines = (from: number, to: number): string =>
    Array.from(
      { length: to - from + 1 },
      (_, i) => `shared line number ${from + i} with some padding text to make it longer\n`
    ).join('');

  describe('rename-free fixtures match v1', () => {
    beforeEach(async () => {
      await initRepo(path.join(tmpDir, 'repo'));
      await write('packages/cli/a.ts', 'a1\n');
      await write('packages/cli/sub/b.ts', 'b1\n');
      await write('apps/web/c.ts', 'c1\n');
      await write(`packages/cli/${FULLWIDTH_TILDE}`, 'u1\n');
      await write(`packages/cli/${EMOJI}`, 'u1\n');
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);

      // Mutations covering every status shape the root node can see, with no renames.
      await write('packages/cli/a.ts', 'a2\n'); // unstaged modification
      await write(`packages/cli/${FULLWIDTH_TILDE}`, 'u2\n'); // unstaged, non-ASCII name
      await write(`packages/cli/${EMOJI}`, 'u2\n'); // unstaged, non-ASCII name
      await write('packages/cli/staged.ts', 'staged\n');
      git(['add', 'packages/cli/staged.ts']); // staged add
      await write('packages/cli/new.ts', 'new\n'); // untracked
      await fs.rm(path.join(repoRoot, 'packages/cli/sub/b.ts')); // unstaged delete
      await write('packages/cli/my file.ts', 'spaces\n'); // untracked, space in name
      await write('apps/web/x.ts', 'x\n'); // untracked, outside pathspec
    });

    test.each([
      ['subdirectory workspace', ['packages/cli']],
      ['repo-root workspace', []],
    ])('%s matches the v1 status', async (_label, pathspec) => {
      expect(await readProbeRoot(pathspec)).toEqual(await readV1Root(pathspec));
    });

    test('non-ASCII names are ordered by UTF-8 bytes, in v1 and in the projection', async () => {
      const nonAscii = [`packages/cli/${FULLWIDTH_TILDE}`, `packages/cli/${EMOJI}`];
      const pick = (view: RootView) =>
        view.entries.map((e) => e.path).filter((p) => nonAscii.includes(p));

      expect(pick(await readV1Root(['packages/cli']))).toEqual(nonAscii);
      expect(pick(await readProbeRoot(['packages/cli']))).toEqual(nonAscii);
    });

    test('a limit equal to the candidate product still matches v1', async () => {
      // Candidates in the full view: 4 add-like (staged, new, my file, apps/web/x) and 1
      // delete-like (sub/b.ts). Product 4 <= 2 squared.
      git(['config', 'diff.renameLimit', '2']);

      expect(await readProbeRootOrUndefined(['packages/cli'])).toEqual(
        await readV1Root(['packages/cli'])
      );
    });

    test('a limit below the candidate product falls back', async () => {
      git(['config', 'diff.renameLimit', '1']);

      expect(await readProbeRootOrUndefined(['packages/cli'])).toBeUndefined();
    });
  });

  describe('fixtures that must fall back', () => {
    test('a rename with both sides inside the pathspec falls back', async () => {
      await initRepo(path.join(tmpDir, 'rename-in'));
      await write('packages/cli/rename-me.ts', 'r1\n');
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);
      git(['mv', 'packages/cli/rename-me.ts', 'packages/cli/renamed.ts']);

      expect((await readV1Root(['packages/cli'])).entries).toContainEqual(
        expect.objectContaining({ xy: 'R ', fromPath: 'packages/cli/rename-me.ts' })
      );
      expect(await readProbeRootOrUndefined(['packages/cli'])).toBeUndefined();
    });

    test('a rename whose origin is inside and destination outside falls back', async () => {
      await initRepo(path.join(tmpDir, 'rename-out'));
      await write('packages/cli/sub/d.ts', 'd1\n');
      await write('apps/web/keep.ts', 'k1\n'); // gives `git mv` an existing destination directory
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);
      git(['mv', 'packages/cli/sub/d.ts', 'apps/web/d.ts']);

      expect((await readV1Root(['packages/cli'])).entries).toContainEqual({
        xy: 'D ',
        path: 'packages/cli/sub/d.ts',
        fromPath: undefined,
      });
      expect(await readProbeRootOrUndefined(['packages/cli'])).toBeUndefined();
    });

    test('a rename whose destination is inside and origin outside falls back', async () => {
      await initRepo(path.join(tmpDir, 'rename-into'));
      await write('apps/web/c.ts', 'c1\n');
      await write('packages/cli/keep.ts', 'k1\n'); // gives `git mv` an existing destination directory
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);
      git(['mv', 'apps/web/c.ts', 'packages/cli/moved.ts']);
      await write('packages/cli/moved.ts', 'c2\n');

      expect((await readV1Root(['packages/cli'])).entries).toContainEqual(
        expect.objectContaining({ xy: 'AM', path: 'packages/cli/moved.ts' })
      );
      expect(await readProbeRootOrUndefined(['packages/cli'])).toBeUndefined();
    });

    test('a rename that competes with an outside candidate falls back', async () => {
      await initRepo(path.join(tmpDir, 'competing'));
      await write('apps/web/b.ts', sharedLines(1, 10));
      await write('packages/cli/a.ts', `${sharedLines(1, 6)}a-only line padding padding padding\n`);
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);
      await fs.rm(path.join(repoRoot, 'apps/web/b.ts'));
      await fs.rm(path.join(repoRoot, 'packages/cli/a.ts'));
      await write('packages/cli/c.ts', `${sharedLines(1, 9)}changed tail line for c\n`);
      git(['add', '-A']);

      expect(
        (await readV1Root(['packages/cli'])).entries.some((e) => e.fromPath !== undefined)
      ).toBe(true);
      expect(await readProbeRootOrUndefined(['packages/cli'])).toBeUndefined();
    });

    test('a rename mixed with modified, untracked, and deleted entries falls back', async () => {
      await initRepo(path.join(tmpDir, 'mixed'));
      await write('packages/cli/rename-me.ts', 'r1\n');
      await write('packages/cli/keep.ts', 'k1\n');
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);
      git(['mv', 'packages/cli/rename-me.ts', 'packages/cli/renamed.ts']);
      await write('packages/cli/keep.ts', 'k2\n');
      await write('packages/cli/aaa.ts', 'new\n');

      expect(await readProbeRootOrUndefined(['packages/cli'])).toBeUndefined();
    });

    test('a pathspec with a glob metacharacter falls back, because v1 matches beyond the literal path', async () => {
      await initRepo(path.join(tmpDir, 'glob'));
      await write('apps/[slug]/page.ts', 'p1\n');
      await write('apps/web/c.ts', 'c1\n');
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);
      await write('apps/[slug]/page.ts', 'p2\n');
      await write('apps/web/c.ts', 'c2\n');

      // `apps/*` is a glob, so v1 reports both siblings. A literal projection would match no path.
      expect((await readV1Root(['apps/*'])).entries.map((e) => e.path).sort()).toEqual([
        'apps/[slug]/page.ts',
        'apps/web/c.ts',
      ]);
      expect(await readProbeRootOrUndefined(['apps/*'])).toBeUndefined();
    });

    test('a rename that only the pathspec view pairs falls back when the full view skipped rename detection', async () => {
      await initRepo(path.join(tmpDir, 'limit'));
      git(['config', 'diff.renameLimit', '2']);
      await write('packages/cli/old.ts', sharedLines(1, 10));
      await write('apps/web/x1.ts', 'unrelated one\n');
      await write('apps/web/x2.ts', 'unrelated two\n');
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);
      await fs.rm(path.join(repoRoot, 'packages/cli/old.ts'));
      await fs.rm(path.join(repoRoot, 'apps/web/x1.ts'));
      await fs.rm(path.join(repoRoot, 'apps/web/x2.ts'));
      await write('packages/cli/new.ts', `${sharedLines(1, 9)}changed tail line\n`);
      await write('apps/web/y1.ts', 'other one\n');
      await write('apps/web/y2.ts', 'other two\n');
      git(['add', '-A']);

      // Full view: 3 add-like and 3 delete-like, product 9 > 2 squared, so git skips inexact
      // detection and shows no rename. Pathspec view: 1 and 1, so it pairs old.ts with new.ts.
      const full = await readV1Root([]);
      const pathspec = await readV1Root(['packages/cli']);
      expect(full.entries.some((e) => e.fromPath !== undefined)).toBe(false);
      expect(full.entries).toContainEqual({
        xy: 'D ',
        path: 'packages/cli/old.ts',
        fromPath: undefined,
      });
      expect(pathspec.entries.some((e) => e.fromPath === 'packages/cli/old.ts')).toBe(true);

      expect(await readProbeRootOrUndefined(['packages/cli'])).toBeUndefined();
    });
  });
});
