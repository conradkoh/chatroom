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

describe('toRootChangeSourceSnapshot', () => {
  const snap = snapshot({
    entries: [
      { xy: ' M', path: 'packages/cli/x.ts' },
      { xy: ' M', path: 'apps/web/y.ts' },
      { xy: 'R ', path: 'packages/cli/new.ts', fromPath: 'packages/cli/old.ts' },
      { xy: ' M', path: 'packages/cli-old/z.ts' },
      { xy: 'R ', path: 'apps/web/moved.ts', fromPath: 'packages/cli/from.ts' },
    ],
  });

  test('keeps entries under the prefix and drops others', () => {
    const { entries } = toRootChangeSourceSnapshot(snap, ['packages/cli']);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('packages/cli/x.ts');
    expect(paths).not.toContain('apps/web/y.ts');
  });

  test('a rename whose origin is inside and destination outside becomes a delete of the origin', () => {
    const { entries } = toRootChangeSourceSnapshot(snap, ['packages/cli']);
    expect(entries).toContainEqual({ xy: 'D ', path: 'packages/cli/from.ts' });
    expect(entries.map((e) => e.path)).not.toContain('apps/web/moved.ts');
  });

  test('a prefix does not match a sibling directory that shares its leading characters', () => {
    const { entries } = toRootChangeSourceSnapshot(snap, ['packages/cli']);
    expect(entries.map((e) => e.path)).not.toContain('packages/cli-old/z.ts');
  });

  test('a trailing slash on the prefix is ignored', () => {
    const { entries } = toRootChangeSourceSnapshot(snap, ['packages/cli/']);
    expect(entries.map((e) => e.path)).toContain('packages/cli/x.ts');
  });

  test('empty pathspec keeps everything', () => {
    const { entries } = toRootChangeSourceSnapshot(snap, []);
    expect(entries).toHaveLength(snap.entries.length);
  });

  test('head is the branch oid', () => {
    expect(toRootChangeSourceSnapshot(snap, []).head).toEqual({ head: 'aaa111' });
  });
});

describe('toRootChangeSourceSnapshot parity with the v1 root reader', () => {
  // Non-ASCII names: git orders them by UTF-8 bytes, which differs from UTF-16 code units.
  const FULLWIDTH_TILDE = '\uFF5E.ts';
  const EMOJI = '\u{1F600}.ts';

  let repoRoot: string;

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
  async function readV1Root(pathspec: string[]) {
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

  async function readProbeRoot(pathspec: string[]) {
    const snapshot = await createWorkspaceGitProbe({
      workTree: repoRoot,
      rootPathspec: pathspec,
      dirtyStatCap: 500,
    }).readSnapshot({ maxAgeMs: 0 });
    const root = toRootChangeSourceSnapshot(snapshot, pathspec);
    return {
      head: root.head,
      entries: root.entries.map(({ xy, path: p, fromPath }) => ({ xy, path: p, fromPath })),
    };
  }

  beforeEach(async () => {
    await initRepo(path.join(tmpDir, 'repo'));
    await write('packages/cli/a.ts', 'a1\n');
    await write('packages/cli/rename-me.ts', 'r1\n');
    await write('packages/cli/sub/b.ts', 'b1\n');
    await write('packages/cli/sub/d.ts', 'd1\n');
    await write('apps/web/c.ts', 'c1\n');
    await write(`packages/cli/${FULLWIDTH_TILDE}`, 'u1\n');
    await write(`packages/cli/${EMOJI}`, 'u1\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'init']);

    // Mutations covering every status shape the root node can see.
    await write('packages/cli/a.ts', 'a2\n'); // unstaged modification
    await write(`packages/cli/${FULLWIDTH_TILDE}`, 'u2\n'); // unstaged, non-ASCII name
    await write(`packages/cli/${EMOJI}`, 'u2\n'); // unstaged, non-ASCII name
    await write('packages/cli/staged.ts', 'staged\n');
    git(['add', 'packages/cli/staged.ts']); // staged add
    await write('packages/cli/new.ts', 'new\n'); // untracked
    await fs.rm(path.join(repoRoot, 'packages/cli/sub/b.ts')); // unstaged delete
    git(['mv', 'packages/cli/rename-me.ts', 'packages/cli/renamed.ts']); // rename inside
    git(['mv', 'apps/web/c.ts', 'packages/cli/moved.ts']); // rename into from outside
    await write('packages/cli/moved.ts', 'c2\n'); // destination also modified
    await write('packages/cli/my file.ts', 'spaces\n'); // untracked, space in name
    await write('apps/web/x.ts', 'x\n'); // untracked, outside pathspec
    git(['mv', 'packages/cli/sub/d.ts', 'apps/web/d.ts']); // rename out of pathspec
    await write('apps/web/d.ts', 'd2\n'); // destination also modified
  });

  test.each([
    ['subdirectory workspace', ['packages/cli']],
    ['repo-root workspace', []],
  ])('%s matches the v1 status', async (_label, pathspec) => {
    expect(await readProbeRoot(pathspec)).toEqual(await readV1Root(pathspec));
  });

  test('boundary-crossing renames match the v1 pathspec output exactly', async () => {
    // moved.ts: origin outside, destination inside, then modified. sub/d.ts: origin inside,
    // destination outside, then modified. Git's pathspec status reports them as an add and a delete.
    const crossing = ['packages/cli/moved.ts', 'packages/cli/sub/d.ts'];
    const pick = (entries: { path: string }[]) => entries.filter((e) => crossing.includes(e.path));

    const probe = await readProbeRoot(['packages/cli']);
    const v1 = await readV1Root(['packages/cli']);
    expect(pick(probe.entries)).toEqual(pick(v1.entries));
    expect(pick(v1.entries)).toEqual([
      { xy: 'AM', path: 'packages/cli/moved.ts' },
      { xy: 'D ', path: 'packages/cli/sub/d.ts' },
    ]);
    // Only the in-pathspec rename (rename-me.ts -> renamed.ts) keeps an origin.
    expect(
      probe.entries.every((e) => e.fromPath === undefined || e.fromPath.startsWith('packages/cli/'))
    ).toBe(true);
  });

  // KNOWN LIMIT. git pairs renames only among the paths it is given. Here the full repo pairs
  // c.ts with the outside b.ts, so the probe emits `A c.ts`, while the pathspec-limited status
  // pairs c.ts with a.ts (`R c.ts <- a.ts`). Re-running the pairing needs blob similarity, which
  // the probe snapshot does not carry. test.fails pins the divergence: when it stops failing,
  // the limit is gone and this test should become a plain parity assertion.
  test.fails(
    'a rename that competes with an outside candidate matches v1 (known limit)',
    async () => {
      await initRepo(path.join(tmpDir, 'competing'));
      const sharedLines = (from: number, to: number): string =>
        Array.from(
          { length: to - from + 1 },
          (_, i) => `shared line number ${from + i} with some padding text to make it longer\n`
        ).join('');
      await write('apps/web/b.ts', sharedLines(1, 10));
      await write('packages/cli/a.ts', `${sharedLines(1, 6)}a-only line padding padding padding\n`);
      git(['add', '-A']);
      git(['commit', '-q', '-m', 'init']);
      await fs.rm(path.join(repoRoot, 'apps/web/b.ts'));
      await fs.rm(path.join(repoRoot, 'packages/cli/a.ts'));
      await write('packages/cli/c.ts', `${sharedLines(1, 9)}changed tail line for c\n`);
      git(['add', '-A']);

      expect(await readProbeRoot(['packages/cli'])).toEqual(await readV1Root(['packages/cli']));
    }
  );
});
