/**
 * workspace-git-probe Unit Tests
 *
 * Covers single-flight reads, cache age, read errors, edit fingerprints, the pure diff rules,
 * and the root pathspec projection. Stat-based cases use a real temp directory.
 */
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
import type {
  GitBranchHeader,
  GitPorcelainEntry,
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
      { xy: 'R.', path: 'packages/cli/new.ts', fromPath: 'packages/cli/old.ts' },
      { xy: ' M', path: 'packages/cli-old/z.ts' },
      { xy: 'R.', path: 'apps/web/moved.ts', fromPath: 'packages/cli/from.ts' },
    ],
  });

  test('keeps entries under the prefix and drops others', () => {
    const { entries } = toRootChangeSourceSnapshot(snap, ['packages/cli']);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('packages/cli/x.ts');
    expect(paths).not.toContain('apps/web/y.ts');
  });

  test('keeps a rename whose fromPath is inside the pathspec', () => {
    const { entries } = toRootChangeSourceSnapshot(snap, ['packages/cli']);
    expect(entries.map((e) => e.path)).toContain('apps/web/moved.ts');
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
